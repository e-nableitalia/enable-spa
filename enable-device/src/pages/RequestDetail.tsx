import { useParams } from "react-router-dom";
import { useEffect, useState, useRef } from "react";
import { doc, getDoc, collection, query, orderBy, getDocs } from "firebase/firestore";
import { db, functions } from "../firebase";
import { httpsCallable } from "firebase/functions";
import { Button } from "primereact/button";
import { Dropdown } from "primereact/dropdown";
import { InputTextarea } from "primereact/inputtextarea";
import RequestTimeline from "../components/timeline/RequestTimeline";
import { Toast } from "primereact/toast";

export default function RequestDetail() {
  const { id } = useParams();
  const [request, setRequest] = useState<any>(null);
  const [events, setEvents] = useState<any[]>([]);
  const [newStatus, setNewStatus] = useState("");
  const [note, setNote] = useState("");
  const toast = useRef<any>(null);

  // Sposta loadData qui, visibile a tutto il componente
  const loadData = async () => {
    if (!id) return;
    const docSnap = await getDoc(doc(db, "deviceRequests", id));
    setRequest(docSnap.data());

    const q = query(
      collection(db, "deviceRequests", id, "events"),
      orderBy("timestamp", "desc")
    );
    const snapshot = await getDocs(q);
    setEvents(snapshot.docs.map((doc) => doc.data()));
  };

  useEffect(() => {
    if (!id) return;
    loadData();
  }, [id]);

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
    await loadData();
  };

  if (!request) return <div>Loading...</div>;

  console.log("Request data:", request);

  return (

    <div style={{ padding: 20 }}>
      {/* Add this at the top level of your component JSX (just inside return) */}
      <Toast ref={toast} />
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
              <div style={{ marginBottom: 10 }}>
                <strong>Status:</strong> {request.status}
              </div>
              <div style={{ marginBottom: 10 }}>
                <strong>Stato pubblico:</strong> {request.publicStatus || "-"}
              </div>
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ marginBottom: 10 }}>
                <strong>Volontario associato:</strong> {request.assignedVolunteer || "-"}
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
          <span>Cambia stato</span>
        </div>
        <div className="p-panel-content">
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
          <Button label="Conferma" onClick={handleChangeStatus} />
        </div>
      </div>

      <div className="p-panel p-component">
        <div className="p-panel-header">
          <span>Timeline</span>
        </div>
        <div className="p-panel-content">
          <RequestTimeline events={events} />
        </div>
      </div>
    </div>
  );
}

