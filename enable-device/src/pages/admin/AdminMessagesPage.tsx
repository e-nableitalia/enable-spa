import { useState, useEffect, useRef, useMemo } from "react";
import {
  collection, getDocs, addDoc, updateDoc, deleteDoc,
  doc, serverTimestamp, query, orderBy,
} from "firebase/firestore";
import { db } from "../../firebase";
import type { GlobalMessage, PersonalMessage } from "../../shared/types/messageData";

import { DataTable } from "primereact/datatable";
import { Column } from "primereact/column";
import { Button } from "primereact/button";
import { Dialog } from "primereact/dialog";
import { InputText } from "primereact/inputtext";
import { InputTextarea } from "primereact/inputtextarea";
import { Dropdown } from "primereact/dropdown";
import { Calendar } from "primereact/calendar";
import { Tag } from "primereact/tag";
import { Toast } from "primereact/toast";
import { TabView, TabPanel } from "primereact/tabview";
import { Toolbar } from "primereact/toolbar";
import { ConfirmDialog, confirmDialog } from "primereact/confirmdialog";

// ---- Types ----

interface UserRecord {
  id: string;
  email: string;
  role: string;
}

interface GlobalMessageForm {
  title: string;
  body: string;
  target: "all" | "volunteer" | "admin";
  expiresAt: Date | null;
  active: boolean;
}

// ---- Helpers ----

function toDate(val: unknown): Date | null {
  if (!val) return null;
  if (typeof (val as Record<string, unknown>)?.toDate === "function")
    return (val as { toDate: () => Date }).toDate();
  if (
    typeof val === "object" &&
    typeof (val as Record<string, unknown>).seconds === "number"
  )
    return new Date(((val as Record<string, unknown>).seconds as number) * 1000);
  const d = new Date(val as string | number);
  return isNaN(d.getTime()) ? null : d;
}

function formatDate(val: unknown): string {
  const d = toDate(val);
  if (!d) return "—";
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${dd}/${mm}/${yyyy} ${hh}:${min}`;
}

const TARGET_LABELS: Record<string, string> = {
  all: "Tutti",
  volunteer: "Volontari",
  admin: "Admin",
};

const TARGET_OPTIONS = [
  { label: "Tutti", value: "all" },
  { label: "Volontari", value: "volunteer" },
  { label: "Admin", value: "admin" },
];

const EMPTY_GLOBAL_FORM: GlobalMessageForm = {
  title: "",
  body: "",
  target: "all",
  expiresAt: null,
  active: true,
};

// ============================================================

export default function AdminMessagesPage() {
  const toast = useRef<Toast>(null);

  // ---- Global messages state ----
  const [globalMessages, setGlobalMessages] = useState<GlobalMessage[]>([]);
  const [loadingGlobal, setLoadingGlobal] = useState(true);
  const [showGlobalDialog, setShowGlobalDialog] = useState(false);
  const [editingGlobal, setEditingGlobal] = useState<GlobalMessage | null>(null);
  const [globalForm, setGlobalForm] = useState<GlobalMessageForm>(EMPTY_GLOBAL_FORM);
  const [savingGlobal, setSavingGlobal] = useState(false);

  // ---- Users state ----
  const [users, setUsers] = useState<UserRecord[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(true);

  // ---- Personal messages state ----
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [personalMessages, setPersonalMessages] = useState<PersonalMessage[]>([]);
  const [loadingPersonal, setLoadingPersonal] = useState(false);
  const [showPersonalDialog, setShowPersonalDialog] = useState(false);
  const [personalForm, setPersonalForm] = useState({ title: "", body: "" });
  const [savingPersonal, setSavingPersonal] = useState(false);

  // Fetch global messages
  useEffect(() => {
    const fetchGlobal = async () => {
      setLoadingGlobal(true);
      try {
        const snap = await getDocs(
          query(collection(db, "messages"), orderBy("createdAt", "desc"))
        );
        setGlobalMessages(snap.docs.map((d) => ({ id: d.id, ...d.data() } as GlobalMessage)));
      } catch (err) {
        console.error("[AdminMessagesPage] Failed to load global messages", err);
      } finally {
        setLoadingGlobal(false);
      }
    };
    fetchGlobal();
  }, []);

  // Fetch users list
  useEffect(() => {
    const fetchUsers = async () => {
      setLoadingUsers(true);
      try {
        const snap = await getDocs(collection(db, "users"));
        setUsers(
          snap.docs.map((d) => {
            const data = d.data() as { email?: string; role?: string };
            return { id: d.id, email: data.email ?? d.id, role: data.role ?? "unknown" };
          })
        );
      } catch (err) {
        console.error("[AdminMessagesPage] Failed to load users", err);
      } finally {
        setLoadingUsers(false);
      }
    };
    fetchUsers();
  }, []);

  // Fetch personal messages when a user is selected
  useEffect(() => {
    if (!selectedUserId) {
      setPersonalMessages([]);
      return;
    }
    const fetchPersonal = async () => {
      setLoadingPersonal(true);
      try {
        const snap = await getDocs(
          query(
            collection(db, `users/${selectedUserId}/messages`),
            orderBy("createdAt", "desc")
          )
        );
        setPersonalMessages(snap.docs.map((d) => ({ id: d.id, ...d.data() } as PersonalMessage)));
      } catch (err) {
        console.error("[AdminMessagesPage] Failed to load personal messages", err);
      } finally {
        setLoadingPersonal(false);
      }
    };
    fetchPersonal();
  }, [selectedUserId]);

  // ---- Global message handlers ----

  const openNewGlobal = () => {
    setEditingGlobal(null);
    setGlobalForm(EMPTY_GLOBAL_FORM);
    setShowGlobalDialog(true);
  };

  const openEditGlobal = (msg: GlobalMessage) => {
    setEditingGlobal(msg);
    setGlobalForm({
      title: msg.title,
      body: msg.body,
      target: msg.target,
      expiresAt: toDate(msg.expiresAt),
      active: msg.active,
    });
    setShowGlobalDialog(true);
  };

  const saveGlobal = async () => {
    if (!globalForm.title.trim() || !globalForm.body.trim()) {
      toast.current?.show({
        severity: "warn",
        summary: "Campi obbligatori",
        detail: "Titolo e testo sono obbligatori.",
        life: 3000,
      });
      return;
    }
    setSavingGlobal(true);
    try {
      const data: Record<string, unknown> = {
        title: globalForm.title.trim(),
        body: globalForm.body.trim(),
        target: globalForm.target,
        active: globalForm.active,
        expiresAt: globalForm.expiresAt ?? null,
      };
      if (editingGlobal) {
        await updateDoc(doc(db, `messages/${editingGlobal.id}`), data);
        setGlobalMessages((prev) =>
          prev.map((m) => (m.id === editingGlobal.id ? { ...m, ...data } as GlobalMessage : m))
        );
        toast.current?.show({ severity: "success", summary: "Salvato", detail: "Messaggio aggiornato.", life: 3000 });
      } else {
        const docRef = await addDoc(collection(db, "messages"), {
          ...data,
          createdAt: serverTimestamp(),
        });
        setGlobalMessages((prev) => [
          { id: docRef.id, ...data, createdAt: new Date() } as unknown as GlobalMessage,
          ...prev,
        ]);
        toast.current?.show({ severity: "success", summary: "Creato", detail: "Messaggio globale creato.", life: 3000 });
      }
      setShowGlobalDialog(false);
    } catch (err) {
      console.error(err);
      toast.current?.show({
        severity: "error",
        summary: "Errore",
        detail: "Impossibile salvare il messaggio.",
        life: 4000,
      });
    } finally {
      setSavingGlobal(false);
    }
  };

  const toggleGlobalActive = async (msg: GlobalMessage) => {
    try {
      await updateDoc(doc(db, `messages/${msg.id}`), { active: !msg.active });
      setGlobalMessages((prev) =>
        prev.map((m) => (m.id === msg.id ? { ...m, active: !m.active } : m))
      );
    } catch {
      toast.current?.show({ severity: "error", summary: "Errore", detail: "Impossibile aggiornare.", life: 3000 });
    }
  };

  const deleteGlobal = (msg: GlobalMessage) => {
    confirmDialog({
      message: `Eliminare il messaggio "${msg.title}"?`,
      header: "Conferma eliminazione",
      icon: "pi pi-exclamation-triangle",
      acceptLabel: "Elimina",
      rejectLabel: "Annulla",
      acceptClassName: "p-button-danger",
      accept: async () => {
        try {
          await deleteDoc(doc(db, `messages/${msg.id}`));
          setGlobalMessages((prev) => prev.filter((m) => m.id !== msg.id));
          toast.current?.show({ severity: "success", summary: "Eliminato", life: 3000 });
        } catch {
          toast.current?.show({ severity: "error", summary: "Errore", detail: "Impossibile eliminare.", life: 3000 });
        }
      },
    });
  };

  // ---- Personal message handlers ----

  const openSendPersonal = () => {
    setPersonalForm({ title: "", body: "" });
    setShowPersonalDialog(true);
  };

  const sendPersonal = async () => {
    if (!selectedUserId) return;
    if (!personalForm.title.trim() || !personalForm.body.trim()) {
      toast.current?.show({
        severity: "warn",
        summary: "Campi obbligatori",
        detail: "Titolo e testo sono obbligatori.",
        life: 3000,
      });
      return;
    }
    setSavingPersonal(true);
    try {
      const docRef = await addDoc(collection(db, `users/${selectedUserId}/messages`), {
        title: personalForm.title.trim(),
        body: personalForm.body.trim(),
        read: false,
        createdAt: serverTimestamp(),
      });
      setPersonalMessages((prev) => [
        {
          id: docRef.id,
          title: personalForm.title.trim(),
          body: personalForm.body.trim(),
          read: false,
          createdAt: new Date(),
        },
        ...prev,
      ]);
      setShowPersonalDialog(false);
      toast.current?.show({ severity: "success", summary: "Inviato", detail: "Messaggio personale inviato.", life: 3000 });
    } catch (err) {
      console.error(err);
      toast.current?.show({
        severity: "error",
        summary: "Errore",
        detail: "Impossibile inviare il messaggio.",
        life: 4000,
      });
    } finally {
      setSavingPersonal(false);
    }
  };

  const deletePersonal = (msg: PersonalMessage) => {
    if (!selectedUserId) return;
    confirmDialog({
      message: `Eliminare il messaggio "${msg.title}"?`,
      header: "Conferma eliminazione",
      icon: "pi pi-exclamation-triangle",
      acceptLabel: "Elimina",
      rejectLabel: "Annulla",
      acceptClassName: "p-button-danger",
      accept: async () => {
        try {
          await deleteDoc(doc(db, `users/${selectedUserId}/messages/${msg.id}`));
          setPersonalMessages((prev) => prev.filter((m) => m.id !== msg.id));
          toast.current?.show({ severity: "success", summary: "Eliminato", life: 3000 });
        } catch {
          toast.current?.show({ severity: "error", summary: "Errore", detail: "Impossibile eliminare.", life: 3000 });
        }
      },
    });
  };

  const userOptions = useMemo(
    () =>
      users
        .slice()
        .sort((a, b) => a.email.localeCompare(b.email))
        .map((u) => ({ label: `${u.email} (${u.role})`, value: u.id })),
    [users]
  );

  // ---- Render ----

  const globalToolbar = (
    <Button label="Nuovo messaggio" icon="pi pi-plus" onClick={openNewGlobal} />
  );

  return (
    <div style={{ width: "100%", padding: 0 }}>
      <Toast ref={toast} />
      <ConfirmDialog />

      {/* Page header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 16,
          background: "linear-gradient(90deg, #7c3aed 0%, #a78bfa 100%)",
          color: "#fff",
          borderRadius: 12,
          padding: "24px 32px",
          marginBottom: 32,
          boxShadow: "0 2px 8px rgba(124,58,237,0.15)",
        }}
      >
        <span className="pi pi-comments" style={{ fontSize: 32, marginRight: 16 }} />
        <div>
          <h2 style={{ margin: 0, fontWeight: 700 }}>Gestione Comunicazioni</h2>
          <p style={{ margin: 0, fontSize: 16 }}>
            Crea e gestisci messaggi globali o personali per i volontari.
          </p>
        </div>
      </div>

      <TabView>
        {/* ---- Tab: Global messages ---- */}
        <TabPanel header="Messaggi globali" leftIcon="pi pi-globe mr-2">
          <Toolbar left={globalToolbar} style={{ marginBottom: 16 }} />
          <DataTable
            value={globalMessages}
            loading={loadingGlobal}
            paginator
            rows={20}
            rowsPerPageOptions={[10, 20, 50]}
            sortField="createdAt"
            sortOrder={-1}
            emptyMessage="Nessun messaggio globale."
          >
            <Column field="title" header="Titolo" sortable style={{ minWidth: 160 }} />
            <Column
              header="Testo"
              body={(row: GlobalMessage) => (
                <span style={{ color: "#555", fontSize: "0.9em" }}>
                  {row.body.length > 80 ? `${row.body.slice(0, 80)}…` : row.body}
                </span>
              )}
              style={{ minWidth: 200 }}
            />
            <Column
              field="target"
              header="Destinatari"
              sortable
              body={(row: GlobalMessage) => (
                <Tag value={TARGET_LABELS[row.target] ?? row.target} severity="info" />
              )}
              style={{ minWidth: 110 }}
            />
            <Column
              field="active"
              header="Stato"
              sortable
              body={(row: GlobalMessage) => (
                <Tag
                  value={row.active ? "Attivo" : "Inattivo"}
                  severity={row.active ? "success" : "secondary"}
                />
              )}
              style={{ minWidth: 90 }}
            />
            <Column
              header="Scadenza"
              body={(row: GlobalMessage) =>
                row.expiresAt ? (
                  formatDate(row.expiresAt)
                ) : (
                  <span style={{ color: "#aaa" }}>Nessuna</span>
                )
              }
              style={{ minWidth: 140 }}
            />
            <Column
              header="Creato"
              body={(row: GlobalMessage) => formatDate(row.createdAt)}
              style={{ minWidth: 130 }}
            />
            <Column
              header="Azioni"
              body={(row: GlobalMessage) => (
                <div style={{ display: "flex", gap: 6 }}>
                  <Button
                    icon="pi pi-pencil"
                    size="small"
                    className="p-button-text p-button-secondary"
                    tooltip="Modifica"
                    onClick={() => openEditGlobal(row)}
                  />
                  <Button
                    icon={row.active ? "pi pi-eye-slash" : "pi pi-eye"}
                    size="small"
                    className="p-button-text p-button-secondary"
                    tooltip={row.active ? "Disattiva" : "Attiva"}
                    onClick={() => toggleGlobalActive(row)}
                  />
                  <Button
                    icon="pi pi-trash"
                    size="small"
                    className="p-button-text p-button-danger"
                    tooltip="Elimina"
                    onClick={() => deleteGlobal(row)}
                  />
                </div>
              )}
              style={{ minWidth: 130 }}
            />
          </DataTable>
        </TabPanel>

        {/* ---- Tab: Personal messages ---- */}
        <TabPanel header="Messaggi personali" leftIcon="pi pi-user mr-2">
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              marginBottom: 20,
              flexWrap: "wrap",
            }}
          >
            <label style={{ fontWeight: 600 }}>Destinatario:</label>
            <Dropdown
              value={selectedUserId}
              options={userOptions}
              onChange={(e) => setSelectedUserId(e.value)}
              placeholder="Seleziona un utente…"
              filter
              showClear
              style={{ minWidth: 320 }}
              loading={loadingUsers}
            />
            {selectedUserId && (
              <Button
                label="Invia messaggio"
                icon="pi pi-send"
                onClick={openSendPersonal}
              />
            )}
          </div>

          {selectedUserId ? (
            <DataTable
              value={personalMessages}
              loading={loadingPersonal}
              paginator
              rows={20}
              rowsPerPageOptions={[10, 20, 50]}
              emptyMessage="Nessun messaggio per questo utente."
            >
              <Column field="title" header="Titolo" style={{ minWidth: 160 }} />
              <Column
                header="Testo"
                body={(row: PersonalMessage) => (
                  <span style={{ color: "#555", fontSize: "0.9em" }}>
                    {row.body.length > 100 ? `${row.body.slice(0, 100)}…` : row.body}
                  </span>
                )}
                style={{ minWidth: 200 }}
              />
              <Column
                field="read"
                header="Stato"
                body={(row: PersonalMessage) => (
                  <Tag
                    value={row.read ? "Letto" : "Non letto"}
                    severity={row.read ? "secondary" : "warning"}
                  />
                )}
                style={{ minWidth: 100 }}
              />
              <Column
                header="Inviato"
                body={(row: PersonalMessage) => formatDate(row.createdAt)}
                style={{ minWidth: 140 }}
              />
              <Column
                header="Azioni"
                body={(row: PersonalMessage) => (
                  <Button
                    icon="pi pi-trash"
                    size="small"
                    className="p-button-text p-button-danger"
                    tooltip="Elimina"
                    onClick={() => deletePersonal(row)}
                  />
                )}
                style={{ minWidth: 70 }}
              />
            </DataTable>
          ) : (
            <div style={{ color: "#aaa", padding: "32px 0", textAlign: "center", fontSize: "0.95em" }}>
              Seleziona un utente per visualizzare o inviare messaggi personali.
            </div>
          )}
        </TabPanel>
      </TabView>

      {/* Dialog: create/edit global message */}
      <Dialog
        header={editingGlobal ? "Modifica messaggio globale" : "Nuovo messaggio globale"}
        visible={showGlobalDialog}
        onHide={() => setShowGlobalDialog(false)}
        style={{ width: 580 }}
        footer={
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <Button
              label="Annulla"
              className="p-button-text"
              onClick={() => setShowGlobalDialog(false)}
            />
            <Button
              label="Salva"
              icon="pi pi-save"
              loading={savingGlobal}
              onClick={saveGlobal}
            />
          </div>
        }
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div>
            <label style={{ fontWeight: 600, display: "block", marginBottom: 4 }}>Titolo *</label>
            <InputText
              value={globalForm.title}
              onChange={(e) => setGlobalForm((f) => ({ ...f, title: e.target.value }))}
              style={{ width: "100%" }}
              placeholder="Titolo del messaggio"
            />
          </div>
          <div>
            <label style={{ fontWeight: 600, display: "block", marginBottom: 4 }}>Testo *</label>
            <InputTextarea
              value={globalForm.body}
              onChange={(e) => setGlobalForm((f) => ({ ...f, body: e.target.value }))}
              rows={5}
              style={{ width: "100%" }}
              placeholder="Testo del messaggio (supporta HTML di base)"
            />
          </div>
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
            <div style={{ flex: 1, minWidth: 160 }}>
              <label style={{ fontWeight: 600, display: "block", marginBottom: 4 }}>Destinatari *</label>
              <Dropdown
                value={globalForm.target}
                options={TARGET_OPTIONS}
                onChange={(e) => setGlobalForm((f) => ({ ...f, target: e.value }))}
                style={{ width: "100%" }}
              />
            </div>
            <div style={{ flex: 1, minWidth: 180 }}>
              <label style={{ fontWeight: 600, display: "block", marginBottom: 4 }}>Scadenza</label>
              <Calendar
                value={globalForm.expiresAt}
                onChange={(e) => setGlobalForm((f) => ({ ...f, expiresAt: (e.value as Date | null) ?? null }))}
                showTime
                hourFormat="24"
                dateFormat="dd/mm/yy"
                style={{ width: "100%" }}
                placeholder="Nessuna scadenza"
                showButtonBar
              />
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <label style={{ fontWeight: 600 }}>Attivo:</label>
            <Button
              label={globalForm.active ? "Sì" : "No"}
              icon={globalForm.active ? "pi pi-check" : "pi pi-times"}
              className={`p-button-sm ${globalForm.active ? "p-button-success" : "p-button-secondary"}`}
              onClick={() => setGlobalForm((f) => ({ ...f, active: !f.active }))}
              type="button"
            />
          </div>
        </div>
      </Dialog>

      {/* Dialog: send personal message */}
      <Dialog
        header="Invia messaggio personale"
        visible={showPersonalDialog}
        onHide={() => setShowPersonalDialog(false)}
        style={{ width: 500 }}
        footer={
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <Button
              label="Annulla"
              className="p-button-text"
              onClick={() => setShowPersonalDialog(false)}
            />
            <Button
              label="Invia"
              icon="pi pi-send"
              loading={savingPersonal}
              onClick={sendPersonal}
            />
          </div>
        }
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div>
            <label style={{ fontWeight: 600, display: "block", marginBottom: 4 }}>Titolo *</label>
            <InputText
              value={personalForm.title}
              onChange={(e) => setPersonalForm((f) => ({ ...f, title: e.target.value }))}
              style={{ width: "100%" }}
              placeholder="Titolo del messaggio"
            />
          </div>
          <div>
            <label style={{ fontWeight: 600, display: "block", marginBottom: 4 }}>Testo *</label>
            <InputTextarea
              value={personalForm.body}
              onChange={(e) => setPersonalForm((f) => ({ ...f, body: e.target.value }))}
              rows={5}
              style={{ width: "100%" }}
              placeholder="Testo del messaggio"
            />
          </div>
        </div>
      </Dialog>
    </div>
  );
}
