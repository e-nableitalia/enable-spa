import { ConfirmDialog, confirmDialog } from "primereact/confirmdialog";
import { useEffect, useState } from "react";
import { Panel } from "primereact/panel";
import { DataTable } from "primereact/datatable";
import { Column } from "primereact/column";
import { Tag, type TagProps } from "primereact/tag";
import { InputText } from "primereact/inputtext";
import { db, functions } from "../../../firebase";
import { collection, getDocs, updateDoc, doc } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { Button } from "primereact/button";
import { Dialog } from "primereact/dialog";


const STATUS_LIST = [
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

export default function ContactsList() {
  const [contacts, setContacts] = useState<any[]>([]);
  const [globalFilter, setGlobalFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [selectedContacts, setSelectedContacts] = useState<any[]>([]);
  const [showDialog, setShowDialog] = useState(false);
  const [targetStatus, setTargetStatus] = useState<string>("");
  const [changing, setChanging] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [inviting, setInviting] = useState(false);
  // Invita i volontari selezionati tramite cloud function
  const handleInviteSelected = async () => {
    if (!selectedContacts.length) return;
    setInviting(true);
    try {
      const inviteVolunteer = httpsCallable(functions, "inviteVolunteer");
      // Passa solo i campi necessari
      const contactsToInvite = selectedContacts.map(({ id, firstName, lastName, email }) => ({ id, firstName, lastName, email }));
      const res: any = await inviteVolunteer({ contacts: contactsToInvite });
      // Aggiorna lo stato dei contatti invitati
      const invitedIds = (res?.data?.results || []).filter((r: any) => r.success).map((r: any) => r.id);
      setContacts(prev => prev.map(c => invitedIds.includes(c.id) ? { ...c, status: "invited" } : c));
    } catch (e) {
      alert("Errore durante l'invito dei volontari. Riprova o verifica i log.");
    }
    setInviting(false);
  };

  useEffect(() => {
    const fetchContacts = async () => {
      const snap = await getDocs(collection(db, "contacts"));
      const data = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
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
  const statusBody = (row: any) => (
    <Tag value={row.status} severity={STATUS_COLORS[row.status] || "secondary"} />
  );

  // Filtro globale su nome, cognome, email
  const filteredContacts = contacts.filter((c) => {
    const matchesStatus = statusFilter ? c.status === statusFilter : true;
    const search = globalFilter.toLowerCase();
    const matchesText =
      c.firstName?.toLowerCase().includes(search) ||
      c.lastName?.toLowerCase().includes(search) ||
      c.email?.toLowerCase().includes(search);
    return matchesStatus && (!globalFilter || matchesText);
  });

  // Opzioni per il filtro stato (solo quelli presenti nella lista e usati)
  const usedStatuses = STATUS_LIST.filter(status => contacts.some(c => c.status === status));

  return (
    <div style={{ padding: 24, margin: "0 auto" }}>
      <Panel header="Contatti Volontari" style={{ marginBottom: 24 }}>
        <ConfirmDialog /> 
        <div style={{ display: "flex", gap: 16, marginBottom: 16, alignItems: "center" }}>
          <InputText
            value={globalFilter}
            onChange={(e) => setGlobalFilter(e.target.value)}
            placeholder="Cerca per nome, cognome o email"
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
            onClick={handleInviteSelected}
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
            sortFunction={(e) => {
              return [...e.data].sort((a, b) => {
          const dateA = a.receivedAt ? new Date(a.receivedAt).getTime() : 0;
          const dateB = b.receivedAt ? new Date(b.receivedAt).getTime() : 0;
          return e.order! * (dateA - dateB);
              });
            }}
          />
          <Column field="firstName" header="Nome" sortable style={{ minWidth: 120 }} />
          <Column field="lastName" header="Cognome" sortable style={{ minWidth: 120 }} />
          <Column field="status" header="Stato" body={statusBody} sortable style={{ minWidth: 100 }} />
          <Column field="email" header="Email" sortable style={{ minWidth: 180 }} />
          <Column field="phone" header="Telefono" style={{ minWidth: 120 }} />
          <Column field="interest" header="Interesse" style={{ minWidth: 120 }} />
          <Column field="description" header="Descrizione" style={{ minWidth: 200 }} />
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
                    } catch {}
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
      </Panel>
    </div>
  );
}
