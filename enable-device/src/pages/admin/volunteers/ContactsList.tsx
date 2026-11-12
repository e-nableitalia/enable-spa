import { ConfirmDialog, confirmDialog } from "primereact/confirmdialog";
import { useEffect, useState } from "react";
import { Panel } from "primereact/panel";
import { DataTable } from "primereact/datatable";
import { Column } from "primereact/column";
import { Tag, type TagProps } from "primereact/tag";
import { InputText } from "primereact/inputtext";
import { db, functions } from "../../../firebase";
import { collection, getDocs, updateDoc, doc, serverTimestamp } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { Button } from "primereact/button";
import { Dialog } from "primereact/dialog";
import { InputTextarea } from "primereact/inputtextarea";
import {
  contactOrigin,
  contactProfileLabel,
  contactsNeedingInviteConfirmation,
  CONTACT_ORIGIN_LABELS as ORIGIN_LABELS,
  CONTACT_PROFILES,
} from "../../../helpers/contactProfiles";


interface ContactDoc {
  id: string;
  firstName?: string;
  lastName?: string;
  email?: string | null;
  phone?: string | null;
  status?: string;
  interest?: string;
  description?: string | null;
  origin?: string;
  profile?: string | null;
  profileOther?: string | null;
  source?: string | null;
  consentPrivacy?: boolean;
  internalNotes?: string;
  receivedAt?: unknown;
  deleted?: boolean;
}

interface InviteResult {
  id: string;
  success: boolean;
}

const STATUS_LIST = [
  "new",
  "imported",
  "import",
  "invited",
  "active",
  "standby",
  "TBV",
  "lost",
  "pending",
  "archived",
  "rejected",
  "completed",
  "disabled"
];

const STATUS_COLORS: Record<string, TagProps['severity']> = {
  new: "warning",
  imported: "info",
  lost: "danger",
  active: "success",
  TBV: "danger",
  standby: "warning",
  import: "info",
  invited: "info",
  pending: "info",
  archived: "secondary",
  rejected: "danger",
  completed: "success",
  disabled: "secondary"
};

function toDate(val: unknown): Date | null {
  if (!val) return null;
  // Firestore Timestamp object with .toDate()
  if (typeof (val as Record<string, unknown>)?.toDate === "function")
    return (val as { toDate: () => Date }).toDate();
  // Plain serialized Firestore Timestamp { seconds, nanoseconds }
  if (typeof val === "object" && typeof (val as Record<string, unknown>).seconds === "number")
    return new Date(((val as Record<string, unknown>).seconds as number) * 1000);
  // String or number — try standard parse (handles ISO 8601 and RFC 2822)
  const d = new Date(val as string | number);
  if (!isNaN(d.getTime())) return d;
  // Italian format "DD/MM/YYYY HH:mm" or "DD/MM/YYYY HH.mm.ss" etc.
  if (typeof val === "string") {
    const m = val.match(/^(\d{2})\/(\d{2})\/(\d{4})[T ](\d{2})[.:](\d{2})(?:[.:](\d{2}))?/);
    if (m) return new Date(`${m[3]}-${m[2]}-${m[1]}T${m[4]}:${m[5]}:${m[6] ?? "00"}`);
  }
  return null;
}

function toMs(val: unknown): number {
  return toDate(val)?.getTime() ?? 0;
}

function formatDate(val: unknown): string {
  const d = toDate(val);
  if (!d) return (val as string) || "";
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${dd}/${mm}/${yyyy} ${hh}:${min}`;
}

export default function ContactsList() {
  const [contacts, setContacts] = useState<ContactDoc[]>([]);
  const [globalFilter, setGlobalFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [selectedContacts, setSelectedContacts] = useState<ContactDoc[]>([]);
  const [showDialog, setShowDialog] = useState(false);
  const [targetStatus, setTargetStatus] = useState<string>("");
  const [changing, setChanging] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [inviting, setInviting] = useState(false);
  const [originFilter, setOriginFilter] = useState<string | null>(null);
  const [profileFilter, setProfileFilter] = useState<string | null>(null);
  const [detailContact, setDetailContact] = useState<ContactDoc | null>(null);
  const [notesDraft, setNotesDraft] = useState("");
  const [savingNotes, setSavingNotes] = useState(false);

  const openDetail = (contact: ContactDoc) => {
    setDetailContact(contact);
    setNotesDraft(contact.internalNotes || "");
  };

  const handleSaveNotes = async () => {
    if (!detailContact) return;
    setSavingNotes(true);
    try {
      await updateDoc(doc(db, "contacts", detailContact.id), {
        internalNotes: notesDraft,
        updatedAt: serverTimestamp(),
      });
      setContacts(prev => prev.map(c => c.id === detailContact.id ? { ...c, internalNotes: notesDraft } : c));
      setDetailContact(null);
    } catch {
      alert("Errore durante il salvataggio delle note. Riprova.");
    }
    setSavingNotes(false);
  };

  // Chiede conferma prima di invitare come volontari contatti arrivati dalla
  // form pubblica con un profilo non da volontario (es. docenti, aziende).
  const requestInviteSelected = () => {
    const toConfirm = contactsNeedingInviteConfirmation(selectedContacts);
    if (!toConfirm.length) {
      handleInviteSelected();
      return;
    }
    confirmDialog({
      message: `${toConfirm.length} dei contatti selezionati sono arrivati dalla form contatti con un profilo diverso da maker o studente (${toConfirm.map(c => `${c.firstName} ${c.lastName}`).join(", ")}). Vuoi invitarli comunque a registrarsi come volontari?`,
      header: "Conferma invito",
      icon: "pi pi-exclamation-triangle",
      acceptLabel: "Invita",
      rejectLabel: "Annulla",
      accept: () => handleInviteSelected(),
      reject: () => {},
    });
  };

  // Invita i volontari selezionati tramite cloud function
  const handleInviteSelected = async () => {
    if (!selectedContacts.length) return;
    setInviting(true);
    try {
      const inviteVolunteer = httpsCallable(functions, "inviteVolunteer");
      // Passa solo i campi necessari
      const contactsToInvite = selectedContacts.map(({ id, firstName, lastName, email }) => ({ id, firstName, lastName, email }));
      const res = await inviteVolunteer({ contacts: contactsToInvite }) as { data?: { results?: InviteResult[] } };
      // Aggiorna lo stato dei contatti invitati
      const invitedIds = (res?.data?.results || []).filter((r) => r.success).map((r) => r.id);
      setContacts(prev => prev.map(c => invitedIds.includes(c.id) ? { ...c, status: "invited" } : c));
    } catch {
      alert("Errore durante l'invito dei volontari. Riprova o verifica i log.");
    }
    setInviting(false);
  };

  useEffect(() => {
    const fetchContacts = async () => {
      const snap = await getDocs(collection(db, "contacts"));
      // I contatti eliminati sono solo marcati con `deleted: true`
      const data = snap.docs
        .map((doc) => ({ id: doc.id, ...doc.data() } as ContactDoc))
        .filter((c) => c.deleted !== true);
      setContacts(data);
    };
    fetchContacts();
  }, []);

  // Elimina i contatti selezionati
  const handleDeleteSelected = () => {
    confirmDialog({
      message: `Sei sicuro di voler eliminare ${selectedContacts.length} contatti?`,
      header: "Conferma eliminazione",
      icon: "pi pi-exclamation-triangle",
      acceptLabel: "Elimina",
      rejectLabel: "Annulla",
      acceptClassName: "p-button-danger",
      accept: async () => {
        setDeleting(true);
        for (const contact of selectedContacts) {
          try {
            await updateDoc(doc(db, "contacts", contact.id), { deleted: true });
          } catch {
            // Error intentionally ignored
          }
        }
        setContacts(prev => prev.filter(c => !selectedContacts.some(sel => sel.id === c.id)));
        setSelectedContacts([]);
        setDeleting(false);
      },
      reject: () => {},
      // AGGIUNTA: assicurati che il dialog sia montato nel DOM
      // Se usi PrimeReact v9+, aggiungi <ConfirmDialog /> nel JSX principale (una sola volta, fuori dal return di ContactsList)
    });
  };

  // Badge per lo stato
  const statusBody = (row: ContactDoc) => (
    <Tag value={row.status} severity={STATUS_COLORS[row.status ?? ""] || "secondary"} />
  );

  // Filtro globale su nome, cognome, email
  const filteredContacts = contacts.filter((c) => {
    const matchesStatus = statusFilter ? c.status === statusFilter : true;
    const matchesOrigin = originFilter ? contactOrigin(c) === originFilter : true;
    const matchesProfile = profileFilter ? c.profile === profileFilter : true;
    const search = globalFilter.toLowerCase();
    const matchesText =
      c.firstName?.toLowerCase().includes(search) ||
      c.lastName?.toLowerCase().includes(search) ||
      c.email?.toLowerCase().includes(search) ||
      c.phone?.toLowerCase().includes(search);
    return matchesStatus && matchesOrigin && matchesProfile && (!globalFilter || matchesText);
  });

  // Opzioni per il filtro stato (solo quelli presenti nella lista e usati)
  const usedStatuses = STATUS_LIST.filter(status => contacts.some(c => c.status === status));

  return (
    <div style={{ padding: 24, margin: "0 auto" }}>
      <Panel header="Contatti" style={{ marginBottom: 24 }}>
        <ConfirmDialog /> 
        <div style={{ display: "flex", gap: 16, marginBottom: 16, alignItems: "center" }}>
          <InputText
            value={globalFilter}
            onChange={(e) => setGlobalFilter(e.target.value)}
            placeholder="Cerca per nome, cognome, email o telefono"
            style={{ width: 260 }}
          />
          <select
            value={statusFilter || ""}
            onChange={(e) => setStatusFilter(e.target.value || null)}
            style={{ padding: 6, borderRadius: 6 }}
          >
            <option value="">Tutti gli stati</option>
            {usedStatuses.map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>
          <select
            aria-label="Filtro origine"
            value={originFilter || ""}
            onChange={(e) => setOriginFilter(e.target.value || null)}
            style={{ padding: 6, borderRadius: 6 }}
          >
            <option value="">Tutte le origini</option>
            {Object.entries(ORIGIN_LABELS).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
          <select
            aria-label="Filtro profilo"
            value={profileFilter || ""}
            onChange={(e) => setProfileFilter(e.target.value || null)}
            style={{ padding: 6, borderRadius: 6 }}
          >
            <option value="">Tutti i profili</option>
            {CONTACT_PROFILES.map((p) => (
              <option key={p.value} value={p.value}>{p.label}</option>
            ))}
          </select>
          <Button
            label="Cambia stato"
            icon="pi pi-refresh"
            className="p-button-warning"
            disabled={!selectedContacts.length || deleting}
            onClick={() => setShowDialog(true)}
          />
          <Button
            label={deleting ? "Eliminazione..." : "Elimina"}
            icon="pi pi-trash"
            className="p-button-danger"
            disabled={!selectedContacts.length || deleting}
            onClick={handleDeleteSelected}
          />
          <Button
            label={inviting ? "Invito in corso..." : "Invita"}
            icon="pi pi-send"
            className="p-button-success"
            disabled={!selectedContacts.length || inviting || deleting}
            onClick={requestInviteSelected}
          />
        </div>
        <DataTable
          value={filteredContacts}
          paginator
          rows={20}
          rowsPerPageOptions={[10, 20, 50]}
          showGridlines
          selection={selectedContacts}
          onSelectionChange={e => setSelectedContacts(e.value)}
          dataKey="id"
          selectionMode="multiple"
        >
          <Column selectionMode="multiple" headerStyle={{ width: '3em' }} />
          <Column
            field="receivedAt"
            header="Ricevuto il"
            sortable
            style={{ minWidth: 180 }}
            body={(row: ContactDoc) => formatDate(row.receivedAt)}
            sortFunction={(e) => {
              return [...e.data].sort((a, b) => (e.order ?? 1) * (toMs(a.receivedAt) - toMs(b.receivedAt)));
            }}
          />
          <Column field="firstName" header="Nome" sortable style={{ minWidth: 120 }} />
          <Column field="lastName" header="Cognome" sortable style={{ minWidth: 120 }} />
          <Column field="status" header="Stato" body={statusBody} sortable style={{ minWidth: 100 }} />
          <Column field="email" header="Email" sortable style={{ minWidth: 180 }} />
          <Column field="phone" header="Telefono" style={{ minWidth: 120 }} />
          <Column
            field="profile"
            header="Profilo"
            sortable
            style={{ minWidth: 140 }}
            body={(row: ContactDoc) => row.profile === "altro" && row.profileOther ? `Altro: ${row.profileOther}` : contactProfileLabel(row.profile)}
          />
          <Column header="Origine" style={{ minWidth: 120 }} body={(row: ContactDoc) => ORIGIN_LABELS[contactOrigin(row)]} />
          <Column field="source" header="Provenienza" style={{ minWidth: 100 }} />
          <Column field="interest" header="Interesse" style={{ minWidth: 120 }} />
          <Column field="description" header="Descrizione / motivo" style={{ minWidth: 200 }} />
          <Column
            header=""
            style={{ width: 60 }}
            body={(row: ContactDoc) => (
              <Button
                icon="pi pi-eye"
                className="p-button-text p-button-sm"
                aria-label={`Dettaglio ${row.firstName ?? ""} ${row.lastName ?? ""}`}
                onClick={() => openDetail(row)}
              />
            )}
          />
        </DataTable>
        <Dialog
          header="Cambia stato contatti selezionati"
          visible={showDialog}
          style={{ width: 350 }}
          modal
          onHide={() => setShowDialog(false)}
          footer={
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <Button label="Annulla" className="p-button-text" onClick={() => setShowDialog(false)} disabled={changing} />
              <Button
                label={changing ? "Aggiornamento..." : "Conferma"}
                className="p-button-success"
                disabled={!targetStatus || changing}
                onClick={async () => {
                  setChanging(true);
                  for (const contact of selectedContacts) {
                    try {
                      await updateDoc(doc(db, "contacts", contact.id), { status: targetStatus });
                    } catch {
                      // L'errore sul singolo contatto non blocca gli altri
                    }
                  }
                  setChanging(false);
                  setShowDialog(false);
                  // Aggiorna la lista locale
                  setContacts(prev => prev.map(c => selectedContacts.some(sel => sel.id === c.id) ? { ...c, status: targetStatus } : c));
                  setSelectedContacts([]);
                  setTargetStatus("");
                }}
              />
            </div>
          }
        >
          <div style={{ marginBottom: 12 }}>
            <label htmlFor="target-status">Nuovo stato:</label>
            <select
              id="target-status"
              value={targetStatus}
              onChange={e => setTargetStatus(e.target.value)}
              style={{ width: "100%", marginTop: 8, padding: 6, borderRadius: 6 }}
            >
              <option value="">Seleziona stato...</option>
              {STATUS_LIST.map((status) => (
                <option key={status} value={status}>{status}</option>
              ))}
            </select>
          </div>
          <div>Numero contatti selezionati: {selectedContacts.length}</div>
        </Dialog>
        <Dialog
          header={detailContact ? `${detailContact.firstName ?? ""} ${detailContact.lastName ?? ""}` : ""}
          visible={detailContact !== null}
          style={{ width: "min(560px, 95vw)" }}
          modal
          onHide={() => setDetailContact(null)}
          footer={
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <Button label="Chiudi" className="p-button-text" onClick={() => setDetailContact(null)} disabled={savingNotes} />
              <Button
                label={savingNotes ? "Salvataggio..." : "Salva note"}
                className="p-button-success"
                disabled={savingNotes}
                onClick={handleSaveNotes}
              />
            </div>
          }
        >
          {detailContact && (
            <dl style={{ display: "grid", gridTemplateColumns: "max-content 1fr", gap: "6px 16px", margin: 0 }}>
              <dt>Ricevuto il</dt><dd style={{ margin: 0 }}>{formatDate(detailContact.receivedAt)}</dd>
              <dt>Stato</dt><dd style={{ margin: 0 }}>{statusBody(detailContact)}</dd>
              <dt>Email</dt><dd style={{ margin: 0 }}>{detailContact.email || "-"}</dd>
              <dt>Telefono</dt><dd style={{ margin: 0 }}>{detailContact.phone || "-"}</dd>
              <dt>Profilo</dt>
              <dd style={{ margin: 0 }}>
                {contactProfileLabel(detailContact.profile) || "-"}
                {detailContact.profile === "altro" && detailContact.profileOther ? ` (${detailContact.profileOther})` : ""}
              </dd>
              <dt>Origine</dt>
              <dd style={{ margin: 0 }}>
                {ORIGIN_LABELS[contactOrigin(detailContact)]}
                {detailContact.source ? ` · ${detailContact.source}` : ""}
              </dd>
              {contactOrigin(detailContact) === "contact-form" && (
                <>
                  <dt>Consenso privacy</dt><dd style={{ margin: 0 }}>{detailContact.consentPrivacy ? "Sì" : "No"}</dd>
                </>
              )}
              <dt>Motivo / note</dt>
              <dd style={{ margin: 0, whiteSpace: "pre-wrap" }}>{detailContact.description || "-"}</dd>
            </dl>
          )}
          <label htmlFor="contact-internal-notes" style={{ display: "block", marginTop: 16, fontWeight: 600 }}>
            Note interne
          </label>
          <InputTextarea
            id="contact-internal-notes"
            rows={4}
            value={notesDraft}
            onChange={(e) => setNotesDraft(e.target.value)}
            style={{ width: "100%", marginTop: 6 }}
          />
        </Dialog>
      </Panel>
    </div>
  );
}
