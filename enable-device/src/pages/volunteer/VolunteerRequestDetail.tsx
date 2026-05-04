import { useParams } from "react-router-dom";
import { useEffect, useState, useRef, useCallback } from "react";
import { doc, getDoc, collection, query, orderBy, getDocs } from "firebase/firestore";
import { db, functions } from "../../firebase";
import { httpsCallable } from "firebase/functions";
import { Button } from "primereact/button";
import { Dropdown } from "primereact/dropdown";
import { InputTextarea } from "primereact/inputtextarea";
import { Toast } from "primereact/toast";
import { Panel } from "primereact/panel";
import { Dialog } from "primereact/dialog";
import { Badge } from "primereact/badge";
import { Toolbar } from "primereact/toolbar";
import RequestTimeline from "../../components/timeline/RequestTimeline";
import { REQUEST_STATUSES } from "../../helpers/requestStatus";

export default function VolunteerRequestDetail() {
  const { id } = useParams();
  const [request, setRequest] = useState<any>(null);
  const [events, setEvents] = useState<any[]>([]);
  const [privateData, setPrivateData] = useState<any>(null);
  const [timelineOpen, setTimelineOpen] = useState(false);
  const [showChangeStatusDialog, setShowChangeStatusDialog] = useState(false);
  const [showAddNoteDialog, setShowAddNoteDialog] = useState(false);
  const [newStatus, setNewStatus] = useState("");
  const [note, setNote] = useState("");
  const [noteText, setNoteText] = useState("");
  const toast = useRef<any>(null);

  async function getUserFullName(userId: string): Promise<string> {
    if (!userId || userId.includes("/")) return userId;
    const profileRef = doc(db, "users", userId, "private", "profile");
    const profileSnap = await getDoc(profileRef);
    if (profileSnap.exists()) {
      const data = profileSnap.data();
      const fullName = `${data.firstName ?? ""} ${data.lastName ?? ""}`.trim();
      return fullName || userId;
    }
    return userId;
  }

  const loadData = useCallback(async () => {
    if (!id) return;
    const docSnap = await getDoc(doc(db, "deviceRequests", id));
    if (docSnap.exists()) {
      setRequest(docSnap.data());
    } else {
      toast.current?.show({ severity: "error", summary: "Errore", detail: "Richiesta non trovata.", life: 4000 });
      setRequest(null);
      return;
    }

    const privateSnap = await getDoc(doc(db, "deviceRequests", id, "private", "data"));
    setPrivateData(privateSnap.exists() ? privateSnap.data() : null);

    // Load public data (contains devicetype and publicStatus)
    const publicSnap = await getDoc(doc(db, "publicDeviceRequests", id));
    if (publicSnap.exists()) {
      const publicData = publicSnap.data();
      setRequest((prev: any) => ({
        ...prev,
        deviceType: publicData.devicetype ?? prev?.deviceType,
        publicStatus: publicData.publicStatus ?? prev?.publicStatus,
      }));
    }

    const q = query(
      collection(db, "deviceRequests", id, "events"),
      orderBy("timestamp", "desc")
    );
    const snapshot = await getDocs(q);
    const eventsData = snapshot.docs.map((d) => d.data());

    const enrichedEvents = await Promise.all(
      eventsData.map(async (ev) => ({
        ...ev,
        userName: ev.createdBy ? await getUserFullName(ev.createdBy) : "-",
      }))
    );
    setEvents(enrichedEvents);
  }, [id]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleChangeStatus = async () => {
    const fn = httpsCallable(functions, "changeStatus");
    const effectiveNote = note.trim() || `cambio stato da "${request?.status}" a "${newStatus}"`;
    await fn({ requestId: id, newStatus, note: effectiveNote });
    toast.current?.show({ severity: "success", summary: "Stato aggiornato", detail: "Lo stato è stato aggiornato.", life: 3000 });
    setShowChangeStatusDialog(false);
    await loadData();
  };

  const handleAddNote = async () => {
    if (!id || !noteText.trim()) return;
    try {
      const previousStatus = events[0]?.status ?? request?.status ?? "sconosciuto";
      const fn = httpsCallable(functions, "changeStatus");
      await fn({ requestId: id, newStatus: previousStatus, note: noteText.trim() });
      toast.current?.show({ severity: "success", summary: "Nota aggiunta", detail: "Nota aggiunta alla cronologia.", life: 3000 });
      setShowAddNoteDialog(false);
      setNoteText("");
      await loadData();
    } catch (error: any) {
      toast.current?.show({ severity: "error", summary: "Errore", detail: error?.message || "Errore durante l'aggiunta della nota.", life: 4000 });
    }
  };

  const goBack = () => window.history.back();

  if (!request) return <div>Loading...</div>;

  return (
    <div style={{ padding: 20 }}>
      <Toast ref={toast} />
      <Toolbar
        left={<Button label="Indietro" icon="pi pi-arrow-left" className="p-button-text" onClick={goBack} />}
        style={{ marginBottom: 16 }}
      />
      <h2>Dettaglio Richiesta</h2>

      {/* Dettagli principali */}
      <div className="p-panel p-component" style={{ marginBottom: 24 }}>
        <div className="p-panel-header"><span>Dettagli richiesta</span></div>
        <div className="p-panel-content">
          <div style={{ display: "flex", gap: 40 }}>
            <div style={{ flex: 1 }}>
              <div style={{ marginBottom: 10 }}><strong>Device:</strong> {request.deviceType || "-"}</div>
              <div style={{ marginBottom: 10, display: "flex", alignItems: "center", gap: 8 }}>
                <strong>Stato:</strong>
                <Badge value={request.status} severity="info" />
                <Button
                  label="Cambia Stato"
                  icon="pi pi-pencil"
                  className="p-button-text"
                  onClick={() => { setNewStatus(request.status ?? ""); setNote(""); setShowChangeStatusDialog(true); }}
                />
              </div>
              {request.publicStatus && (
                <div style={{ marginBottom: 10, display: "flex", alignItems: "center", gap: 8 }}>
                  <strong>Stato pubblico:</strong>
                  <Badge value={request.publicStatus} severity="warning" />
                </div>
              )}
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ marginBottom: 10 }}><strong>N° richiesta:</strong> {request.requestNumber || "-"}</div>
              <div style={{ marginBottom: 10 }}><strong>Data creazione:</strong>{" "}{request.createdAt?.toDate ? request.createdAt.toDate().toLocaleString() : "-"}</div>
              <div style={{ marginBottom: 10 }}><strong>Ultimo aggiornamento:</strong>{" "}{request.updatedAt?.toDate ? request.updatedAt.toDate().toLocaleString() : "-"}</div>
              <div style={{ marginBottom: 10 }}><strong>Età:</strong> {request.age ?? "-"}</div>
            </div>
          </div>
        </div>
      </div>

      {/* Informazioni pubbliche richiesta */}
      {(request.recipient || request.relation || request.descriptionPublic || request.preferencesPublic) && (
        <div className="p-panel p-component" style={{ marginBottom: 24 }}>
          <div className="p-panel-header"><span>Informazioni pubbliche</span></div>
          <div className="p-panel-content">
            <div style={{ display: "flex", gap: 40, marginBottom: request.descriptionPublic || request.preferencesPublic ? 12 : 0 }}>
              {request.recipient && (
                <div style={{ flex: 1 }}>
                  <div style={{ marginBottom: 10 }}><strong>Destinatario:</strong> {request.recipient}</div>
                </div>
              )}
              {request.relation && (
                <div style={{ flex: 1 }}>
                  <div style={{ marginBottom: 10 }}><strong>Relazione:</strong> {request.relation}</div>
                </div>
              )}
            </div>
            {request.descriptionPublic && (
              <div style={{ marginBottom: 10 }}>
                <strong>Descrizione:</strong>
                <div style={{ marginTop: 4, whiteSpace: "pre-wrap" }}>{request.descriptionPublic}</div>
              </div>
            )}
            {request.preferencesPublic && (
              <div style={{ marginBottom: 10 }}>
                <strong>Preferenze:</strong>
                <div style={{ marginTop: 4, whiteSpace: "pre-wrap" }}>{request.preferencesPublic}</div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Dati richiedente */}
      {privateData && (
        <div className="p-panel p-component" style={{ marginBottom: 24 }}>
          <div className="p-panel-header"><span>Dati richiedente</span></div>
          <div className="p-panel-content">
            <div style={{ display: "flex", gap: 40 }}>
              <div style={{ flex: 1 }}>
                <div style={{ marginBottom: 10 }}><strong>Nome:</strong> {privateData.firstName || "-"}</div>
                <div style={{ marginBottom: 10 }}><strong>Cognome:</strong> {privateData.lastName || "-"}</div>
                <div style={{ marginBottom: 10 }}><strong>Telefono:</strong> {privateData.phone || "-"}</div>
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ marginBottom: 10 }}><strong>Tipo amputazione:</strong> {privateData.amputationType || "-"}</div>
                <div style={{ marginBottom: 10 }}><strong>Descrizione:</strong> {privateData.description || "-"}</div>
                <div style={{ marginBottom: 10 }}><strong>Preferenze:</strong> {privateData.preferences || "-"}</div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Indirizzo di spedizione */}
      {request.shippingAddress?.street && (
        <div className="p-panel p-component" style={{ marginBottom: 24 }}>
          <div className="p-panel-header"><span>Indirizzo di spedizione</span></div>
          <div className="p-panel-content">
            <div style={{ display: "flex", gap: 40 }}>
              <div style={{ flex: 1 }}>
                <div style={{ marginBottom: 8 }}><strong>Nominativo:</strong> {request.shippingAddress.fullName || "-"}</div>
                <div style={{ marginBottom: 8 }}><strong>Via:</strong> {request.shippingAddress.street}</div>
                <div style={{ marginBottom: 8 }}><strong>CAP:</strong> {request.shippingAddress.postalCode}</div>
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ marginBottom: 8 }}><strong>Città:</strong> {request.shippingAddress.city}</div>
                <div style={{ marginBottom: 8 }}><strong>Provincia:</strong> {request.shippingAddress.province}</div>
                <div style={{ marginBottom: 8 }}><strong>Paese:</strong> {request.shippingAddress.country}</div>
                {request.shippingAddress.phone && <div style={{ marginBottom: 8 }}><strong>Telefono:</strong> {request.shippingAddress.phone}</div>}
                {request.shippingAddress.notes && <div style={{ marginBottom: 8 }}><strong>Note:</strong> {request.shippingAddress.notes}</div>}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Ultimo evento */}
      <Panel
        header={
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span>Ultimo evento</span>
            <Button label="Aggiungi nota" icon="pi pi-plus" className="p-button-text" onClick={() => setShowAddNoteDialog(true)} />
          </div>
        }
        style={{ marginBottom: 24 }}
      >
        {events.length > 0 ? (
          <div>
            <strong>{events[0].status}</strong>
            <div>{events[0].timestamp?.toDate ? events[0].timestamp.toDate().toLocaleString() : "-"}</div>
            {events[0].note && <div><strong>Nota:</strong> {events[0].note}</div>}
          </div>
        ) : (
          <div>Nessun evento disponibile.</div>
        )}
      </Panel>

      {/* Dialog cambio stato */}
      <Dialog
        header="Cambia stato richiesta"
        visible={showChangeStatusDialog}
        style={{ width: "500px" }}
        modal
        onHide={() => setShowChangeStatusDialog(false)}
      >
        <div style={{ marginBottom: 15 }}>
          <Dropdown
            value={newStatus}
            options={REQUEST_STATUSES}
            onChange={(e) => setNewStatus(e.value)}
            placeholder="Seleziona stato"
            style={{ width: "100%" }}
          />
        </div>
        <div style={{ marginBottom: 15 }}>
          <label htmlFor="note" style={{ display: "block", marginBottom: 5 }}>Note</label>
          <InputTextarea
            id="note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            style={{ width: "100%" }}
          />
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <Button label="Annulla" className="p-button-text" onClick={() => setShowChangeStatusDialog(false)} />
          <Button label="Conferma" onClick={handleChangeStatus} disabled={!newStatus} />
        </div>
      </Dialog>

      {/* Dialog aggiungi nota */}
      <Dialog
        header="Aggiungi nota"
        visible={showAddNoteDialog}
        style={{ width: "400px" }}
        modal
        onHide={() => setShowAddNoteDialog(false)}
      >
        <div style={{ marginBottom: 15 }}>
          <label htmlFor="noteText" style={{ display: "block", marginBottom: 5 }}>Testo nota</label>
          <InputTextarea
            id="noteText"
            value={noteText}
            onChange={(e) => setNoteText(e.target.value)}
            rows={3}
            style={{ width: "100%" }}
          />
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <Button label="Annulla" className="p-button-text" onClick={() => setShowAddNoteDialog(false)} />
          <Button label="Aggiungi" onClick={handleAddNote} disabled={!noteText.trim()} />
        </div>
      </Dialog>

      {/* Timeline */}
      <Panel
        header="Cronologia richiesta"
        toggleable
        collapsed={!timelineOpen}
        onToggle={() => setTimelineOpen(!timelineOpen)}
      >
        <RequestTimeline events={events} />
      </Panel>
    </div>
  );
}
