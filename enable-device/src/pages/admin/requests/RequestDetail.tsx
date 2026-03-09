import { useParams } from "react-router-dom";
import { useEffect, useState, useRef, useCallback } from "react";
import { doc, getDoc, collection, query, orderBy, getDocs } from "firebase/firestore";
import { db, functions } from "../../../firebase";
import { httpsCallable } from "firebase/functions";
import { Button } from "primereact/button";
import { Dropdown } from "primereact/dropdown";
import { InputTextarea } from "primereact/inputtextarea";
import RequestTimeline from "../../../components/timeline/RequestTimeline";
import { Toast } from "primereact/toast";
import { Panel } from "primereact/panel";
import { Dialog } from "primereact/dialog";
import { Badge } from "primereact/badge";
import { Toolbar } from "primereact/toolbar";

export default function RequestDetail() {
  const { id } = useParams();
  const [request, setRequest] = useState<any>(null);
  const [events, setEvents] = useState<any[]>([]);
  const [newStatus, setNewStatus] = useState("");
  const [note, setNote] = useState("");
  const [privateData, setPrivateData] = useState<any>(null);
  const [timelineOpen, setTimelineOpen] = useState(false);
  const [showChangeStatusDialog, setShowChangeStatusDialog] = useState(false);
  const [showAssignVolunteerDialog, setShowAssignVolunteerDialog] = useState(false);
  const [showAddNoteDialog, setShowAddNoteDialog] = useState(false);
  const [volunteers, setVolunteers] = useState<any[]>([]);
  const [selectedVolunteer, setSelectedVolunteer] = useState<any>(null);
  const [noteText, setNoteText] = useState("");
  const toast = useRef<any>(null);

  /**
   * Recupera il nome completo di un utente dato il suo userId.
   * Se non trova il profilo privato, ritorna lo userId.
   */
  async function getUserFullName(userId: string): Promise<string> {
    const profileRef = doc(db, "users", userId, "private", "profile");
    const profileSnap = await getDoc(profileRef);
    if (profileSnap.exists()) {
      const data = profileSnap.data();
      const firstName = data.firstName || "";
      const lastName = data.lastName || "";
      const fullName = `${firstName} ${lastName}`.trim();
      return fullName || userId;
    }
    return userId;
  }

  const loadData = useCallback(async () => {
    if (!id) return;
    const docSnap = await getDoc(doc(db, "deviceRequests", id));
    if (docSnap.exists()) {
      const data = docSnap.data();
      if (data.assignedVolunteer) {
        const volunteerName = await getUserFullName(data.assignedVolunteer);
        setRequest({
          ...data,
          assignedVolunteerName: volunteerName,
        });
      } else {
        setRequest(data);
      }
    } else {
      toast.current?.show({
        severity: "error",
        summary: "Errore",
        detail: "Richiesta non trovata.",
        life: 4000,
      });
      setRequest(null);
      return;
    }
    // Load private data
    const privateSnap = await getDoc(doc(db, "deviceRequests", id, "private", "data"));
    setPrivateData(privateSnap.exists() ? privateSnap.data() : null);



    const q = query(
      collection(db, "deviceRequests", id, "events"),
      orderBy("timestamp", "desc")
    );
    const snapshot = await getDocs(q);
    const eventsData = snapshot.docs.map((doc) => doc.data());

    // Arricchisci gli eventi con nome e cognome usando getUserFullName
    const enrichedEvents = await Promise.all(
      eventsData.map(async (ev) => ({
        ...ev,
        userName: ev.createdBy ? await getUserFullName(ev.createdBy) : "-"
      }))
    );

    setEvents(enrichedEvents);
  }, [id]);

  const fetchVolunteers = useCallback(async () => {
    // Recupera tutti gli utenti, poi per ciascuno prendi il profilo privato
    const usersSnapshot = await getDocs(collection(db, "users"));
    const userProfiles = await Promise.all(
      usersSnapshot.docs
        .filter((userDoc) => userDoc.data().active === true)
        .map(async (userDoc) => {
          const profileSnap = await getDoc(doc(db, "users", userDoc.id, "private", "profile"));
          if (profileSnap.exists()) {
            return { id: userDoc.id, ...profileSnap.data() };
          }
          return null;
        })
    );

    // Filtra solo i volontari e ordina per firstName
    const list = userProfiles
      .filter((u): u is NonNullable<typeof u> => !!u);
    setVolunteers(list);
  }, []);

  useEffect(() => {
    if (!id) return;
    loadData();
    fetchVolunteers();
  }, [id, loadData, fetchVolunteers]);

  const handleChangeStatus = async () => {
    const fn = httpsCallable(functions, "changeStatus");
    await fn({
      requestId: id,
      newStatus,
      note
    });
    toast.current?.show({
      severity: "success",
      summary: "Stato aggiornato",
      detail: "Lo stato della richiesta è stato aggiornato.",
      life: 3000,
    });
    setShowChangeStatusDialog(false);
    await loadData();
  };

  const handleAssignVolunteer = async () => {
    if (!selectedVolunteer) return;
    if (!id) return;
    try {
      const fn = httpsCallable(functions, "assignVolunteer");
      await fn({
        deviceId: id,
        userId: selectedVolunteer.id,
      });
      toast.current?.show({
        severity: "success",
        summary: "Volontario associato",
        detail: "Il volontario è stato associato alla richiesta.",
        life: 3000,
      });
      setShowAssignVolunteerDialog(false);
      setSelectedVolunteer(null);
    } catch (error: any) {
      toast.current?.show({
        severity: "error",
        summary: "Errore",
        detail: error?.message || "Errore durante l'associazione del volontario.",
        life: 4000,
      });
    }
    await loadData();
  };

  const handleAddNote = async () => {
    if (!id || !noteText.trim()) return;
    try {
      // Recupera lo stato precedente (ultimo evento)
      const lastEvent = events[0];
      const previousStatus = lastEvent?.status || request.status || "sconosciuto";

      // Aggiungi evento come cambiamento di stato con lo stesso stato precedente e nota
      const fn = httpsCallable(functions, "changeStatus");
      await fn({
        requestId: id,
        newStatus: previousStatus,
        note: noteText.trim()
      });
      toast.current?.show({
        severity: "success",
        summary: "Nota aggiunta",
        detail: "Nota aggiunta alla cronologia.",
        life: 3000,
      });
      setShowAddNoteDialog(false);
      setNoteText("");
      await loadData();
    } catch (error: any) {
      toast.current?.show({
        severity: "error",
        summary: "Errore",
        detail: error?.message || "Errore durante l'aggiunta della nota.",
        life: 4000,
      });
    }
  };

  const goBack = () => {
    window.history.back();
  };

  const leftToolbarTemplate = () => (
    <Button
      label="Indietro"
      icon="pi pi-arrow-left"
      className="p-button-text"
      onClick={goBack}
    />
  );

  if (!request) return <div>Loading...</div>;

  return (
    <div style={{ padding: 20 }}>
      <Toast ref={toast} />
      <Toolbar left={leftToolbarTemplate} style={{ marginBottom: 16 }} />
      <h2>Request Detail</h2>

      <div className="p-panel p-component" style={{ marginBottom: 30 }}>
        <div className="p-panel-header">
          <span>Dettagli richiesta</span>
        </div>
        <div className="p-panel-content">
          <div style={{ display: "flex", gap: 40 }}>
            <div style={{ flex: 1 }}>
              <div style={{ marginBottom: 10 }}>
                <strong>Device:</strong> {request.deviceType}
              </div>
              <div style={{ marginBottom: 10, display: "flex", alignItems: "center", gap: 8 }}>
                <strong>Status:</strong>
                <span style={{ marginLeft: 8 }}>
                  <Badge value={request.status} severity="info" />
                </span>
                <Button
                  label="Cambia Stato"
                  icon="pi pi-pencil"
                  className="p-button-text"
                  style={{ marginLeft: 8 }}
                  onClick={() => setShowChangeStatusDialog(true)}
                />
              </div>
              <div style={{ marginBottom: 10 }}>
                <strong>Stato pubblico:</strong>
                {request.publicStatus ? (
                  <span style={{ marginLeft: 8 }}>
                    <Badge value={request.publicStatus} severity="warning" />
                  </span>
                ) : (
                  <span style={{ marginLeft: 8 }}>-</span>
                )}
              </div>
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ marginBottom: 10 }}>
                <strong>Volontario associato:</strong>{" "}
                {request.assignedVolunteerName
                  ? request.assignedVolunteerName
                  : request.assignedVolunteer
                    ? request.assignedVolunteer
                    : "-"}
                <Button
                  label="Associa volontario"
                  icon="pi pi-pencil"
                  className="p-button-text"
                  style={{ marginLeft: 8 }}
                  onClick={() => setShowAssignVolunteerDialog(true)}
                />
              </div>
              <div style={{ marginBottom: 10 }}>
                <strong>Data creazione:</strong>{" "}
                {request.createdAt?.toDate
                  ? request.createdAt.toDate().toLocaleString()
                  : "-"}
              </div>
              <div style={{ marginBottom: 10 }}>
                <strong>Ultimo aggiornamento:</strong>{" "}
                {request.updatedAt?.toDate
                  ? request.updatedAt.toDate().toLocaleString()
                  : "-"}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="p-panel p-component" style={{ marginBottom: 30 }}>
        <div className="p-panel-header">
          <span>Dati richiedente (privati)</span>
        </div>
        <div className="p-panel-content">
          {privateData ? (
            <div style={{ display: "flex", gap: 40 }}>
              <div style={{ flex: 1 }}>
                <div style={{ marginBottom: 10 }}>
                  <strong>Email:</strong> {privateData.email || "-"}
                </div>
                <div style={{ marginBottom: 10 }}>
                  <strong>Nome:</strong> {privateData.firstName || "-"}
                </div>
                <div style={{ marginBottom: 10 }}>
                  <strong>Cognome:</strong> {privateData.lastName || "-"}
                </div>
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ marginBottom: 10 }}>
                  <strong>Consenso privacy:</strong> {privateData.consentPrivacy ? "Sì" : "No"}
                </div>
                <div style={{ marginBottom: 10 }}>
                  <strong>Telefono:</strong> {privateData.phone || "-"}
                </div>
                <div style={{ marginBottom: 10 }}>
                  <strong>Descrizione:</strong> {privateData.description || "-"}
                </div>
              </div>
            </div>
          ) : (
            <div>Nessun dato privato disponibile.</div>
          )}
        </div>
      </div>

      {/* Ultimo stato come panel con bottone e dialog */}
      <Panel
        header={
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span>Ultimo evento</span>
            <Button
              label="Aggiungi nota"
              icon="pi pi-plus"
              className="p-button-text"
              onClick={() => setShowAddNoteDialog(true)}
            />
          </div>
        }
        style={{ marginBottom: 30 }}
      >
        {events.length > 0 ? (
          <div>
            <strong>{events[0].status}</strong>
            <div>
              <span>
                {events[0].timestamp?.toDate
                  ? events[0].timestamp.toDate().toLocaleString()
                  : "-"}
              </span>
            </div>
            {events[0].note && (
              <div>
                <strong>Nota:</strong> {events[0].note}
              </div>
            )}
          </div>
        ) : (
          <div>Nessun evento disponibile.</div>
        )}
      </Panel>

      {/* Dialog modale per cambio stato */}
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
            options={[
              "famiglia contattata",
              "definizione richiesta",
              "valutazione fattibilità",
              "attesa volontario",
              "annullata"
            ]}
            onChange={(e) => setNewStatus(e.value)}
            placeholder="Seleziona stato"
            className="mb-3"
            style={{ width: "100%" }}
          />
        </div>
        <div style={{ marginBottom: 15 }}>
          <label htmlFor="note" style={{ display: "block", marginBottom: 5 }}>
            Note
          </label>
          <InputTextarea
            id="note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            className="mb-3"
            style={{ width: "100%" }}
          />
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <Button label="Annulla" className="p-button-text" onClick={() => setShowChangeStatusDialog(false)} />
          <Button label="Conferma" onClick={handleChangeStatus} />
        </div>
      </Dialog>

      {/* Dialog per associare volontario */}
      <Dialog
        header="Associa volontario"
        visible={showAssignVolunteerDialog}
        style={{ width: "400px" }}
        modal
        onHide={() => setShowAssignVolunteerDialog(false)}
      >
        <div style={{ marginBottom: 15 }}>
          <Dropdown
            value={selectedVolunteer}
            options={volunteers}
            optionLabel="fullName"
            itemTemplate={(option) =>
              option ? (
                <span>
                  {option.firstName} {option.lastName}
                </span>
              ) : null
            }
            onChange={(e) => setSelectedVolunteer(e.value)}
            placeholder="Seleziona volontario"
            style={{ width: "100%" }}
            filter
            showClear
          />
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <Button label="Annulla" className="p-button-text" onClick={() => setShowAssignVolunteerDialog(false)} />
          <Button label="Conferma" onClick={handleAssignVolunteer} disabled={!selectedVolunteer} />
        </div>
      </Dialog>

      {/* Dialog per aggiungere nota */}
      <Dialog
        header="Aggiungi nota"
        visible={showAddNoteDialog}
        style={{ width: "400px" }}
        modal
        onHide={() => setShowAddNoteDialog(false)}
      >
        <div style={{ marginBottom: 15 }}>
          <label htmlFor="noteText" style={{ display: "block", marginBottom: 5 }}>
            Testo nota
          </label>
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

      {/* Timeline collapsable */}
      <Panel
        header="Cronologia gestione richiesta"
        toggleable
        collapsed={!timelineOpen}
        onToggle={() => setTimelineOpen(!timelineOpen)}
        style={{ marginBottom: 30 }}
      >
        <RequestTimeline events={events} />
      </Panel>
    </div>
  );
}

