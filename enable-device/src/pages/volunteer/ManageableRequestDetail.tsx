import { useParams, useNavigate } from "react-router-dom";
import { useEffect, useState, useCallback } from "react";
import { doc, getDoc, collection, query, orderBy, getDocs } from "firebase/firestore";
import { db } from "../../firebase";
import { Button } from "primereact/button";
import { Tag } from "primereact/tag";
import { Panel } from "primereact/panel";
import { Divider } from "primereact/divider";
import { DataTable } from "primereact/datatable";
import { Column } from "primereact/column";
import { PUBLIC_STATUS_SEVERITY } from "../../helpers/requestStatus";

function toDate(val: unknown): Date | null {
  if (!val) return null;
  if (typeof (val as Record<string, unknown>)?.toDate === "function")
    return (val as { toDate: () => Date }).toDate();
  if (typeof val === "object" && typeof (val as Record<string, unknown>).seconds === "number")
    return new Date(((val as Record<string, unknown>).seconds as number) * 1000);
  const d = new Date(val as string | number);
  return Number.isNaN(d.getTime()) ? null : d;
}

function formatDate(val: unknown): string {
  const d = toDate(val);
  if (!d) return "-";
  return d.toLocaleDateString("it-IT", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
      <span style={{ fontWeight: 600, minWidth: 160 }}>{label}:</span>
      <span>{value ?? "-"}</span>
    </div>
  );
}

export default function ManageableRequestDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [request, setRequest] = useState<any>(null);
  const [events, setEvents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async () => {
    if (!id) return;
    try {
      const publicSnap = await getDoc(doc(db, "publicDeviceRequests", id));
      if (!publicSnap.exists()) {
        setRequest(null);
        return;
      }
      setRequest({ id: publicSnap.id, ...publicSnap.data() });

      // Try loading events (may fail if the volunteer isn't assigned - handled silently)
      try {
        const eventsSnap = await getDocs(
          query(collection(db, "deviceRequests", id, "events"), orderBy("timestamp", "desc"))
        );
        setEvents(eventsSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
      } catch {
        setEvents([]);
      }
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { loadData(); }, [loadData]);

  if (loading) {
    return (
      <div style={{ textAlign: "center", marginTop: 80 }}>
        <span className="pi pi-spin pi-spinner" style={{ fontSize: 32 }} />
      </div>
    );
  }

  if (!request) {
    return (
      <div style={{ padding: 32 }}>
        <p>Richiesta non trovata.</p>
        <Button label="Torna all'elenco" icon="pi pi-arrow-left" onClick={() => navigate("/volunteer/manageable-requests")} />
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 900, margin: "0 auto", padding: "0 16px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 24 }}>
        <Button
          icon="pi pi-arrow-left"
          className="p-button-text"
          onClick={() => navigate("/volunteer/manageable-requests")}
          tooltip="Torna all'elenco"
        />
        <h2 style={{ margin: 0 }}>
          Richiesta #{request.requestNumber ?? id}
        </h2>
        {request.publicStatus && (
          <Tag
            value={request.publicStatus}
            severity={PUBLIC_STATUS_SEVERITY[request.publicStatus] ?? "secondary"}
          />
        )}
      </div>

      <Panel header="Informazioni richiesta" style={{ marginBottom: 16 }}>
        <Field label="Numero richiesta" value={request.requestNumber} />
        <Field label="Tipo device" value={request.devicetype} />
        <Field label="Fascia d'età" value={request.ageRange} />
        <Field label="Provincia" value={request.province} />
        <Field label="Stato pubblico" value={
          request.publicStatus
            ? <Tag value={request.publicStatus} severity={PUBLIC_STATUS_SEVERITY[request.publicStatus] ?? "secondary"} />
            : "-"
        } />
        <Divider />
        <Field label="Creata il" value={formatDate(request.createdAt)} />
        <Field label="Aggiornata il" value={formatDate(request.updatedAt)} />
      </Panel>

      {events.length > 0 && (
        <Panel header={`Storico eventi (${events.length})`} toggleable style={{ marginBottom: 16 }}>
          <DataTable value={events} size="small">
            <Column
              field="timestamp"
              header="Data"
              body={(row) => formatDate(row.timestamp)}
              style={{ width: "13rem" }}
            />
            <Column field="status" header="Stato" />
            <Column field="note" header="Nota" />
          </DataTable>
        </Panel>
      )}
    </div>
  );
}
