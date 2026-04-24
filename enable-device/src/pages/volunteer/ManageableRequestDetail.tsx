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

  async function getUserFullName(userId: string): Promise<string> {
    if (!userId || userId.includes("/")) return userId;
    try {
      const profileRef = doc(db, "users", userId, "private", "profile");
      const profileSnap = await getDoc(profileRef);
      if (profileSnap.exists()) {
        const data = profileSnap.data();
        const firstName = data.firstName || "";
        const lastName = data.lastName || "";
        const fullName = `${firstName} ${lastName}`.trim();
        return fullName || userId;
      }
    } catch { /* skip */ }
    return userId;
  }

  const loadData = useCallback(async () => {
    if (!id) return;
    try {
      const publicSnap = await getDoc(doc(db, "publicDeviceRequests", id));
      if (!publicSnap.exists()) {
        setRequest(null);
        return;
      }
      const publicData = { id: publicSnap.id, ...publicSnap.data() };

      // Load public operational fields stored in deviceRequests
      try {
        const reqSnap = await getDoc(doc(db, "deviceRequests", id));
        if (reqSnap.exists()) {
          const d = reqSnap.data();
          (publicData as Record<string, unknown>).recipient = d.recipient ?? null;
          (publicData as Record<string, unknown>).relation = d.relation ?? null;
          (publicData as Record<string, unknown>).descriptionPublic = d.descriptionPublic ?? null;
          (publicData as Record<string, unknown>).preferencesPublic = d.preferencesPublic ?? null;
        }
      } catch {
        // not accessible — skip
      }

      setRequest(publicData);

      // Try loading events (may fail if the volunteer isn't assigned - handled silently)
      try {
        const eventsSnap = await getDocs(
          query(collection(db, "deviceRequests", id, "events"), orderBy("timestamp", "desc"))
        );
        const rawEvents = eventsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
        const enriched = await Promise.all(
          rawEvents.map(async (ev: any) => ({
            ...ev,
            userName: ev.createdBy ? await getUserFullName(ev.createdBy) : "-",
          }))
        );
        setEvents(enriched);
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

      {(request.recipient || request.relation || request.descriptionPublic || request.preferencesPublic) && (
        <Panel header="Informazioni pubbliche" style={{ marginBottom: 16 }}>
          {request.recipient && <Field label="Destinatario" value={request.recipient} />}
          {request.relation && <Field label="Relazione" value={request.relation} />}
          {request.descriptionPublic && (
            <div style={{ marginBottom: 8 }}>
              <span style={{ fontWeight: 600 }}>Descrizione:</span>
              <div style={{ marginTop: 4, whiteSpace: "pre-wrap" }}>{request.descriptionPublic}</div>
            </div>
          )}
          {request.preferencesPublic && (
            <div style={{ marginBottom: 8 }}>
              <span style={{ fontWeight: 600 }}>Preferenze:</span>
              <div style={{ marginTop: 4, whiteSpace: "pre-wrap" }}>{request.preferencesPublic}</div>
            </div>
          )}
        </Panel>
      )}

      {events.length > 0 && (
        <Panel header={`Storico eventi (${events.length})`} toggleable style={{ marginBottom: 16 }}>
          <DataTable value={events} size="small">
            <Column
              field="timestamp"
              header="Data"
              body={(row) => formatDate(row.timestamp)}
              style={{ width: "13rem" }}
            />
            <Column field="status" header="Stato" body={(row) => row.toStatus ?? row.status ?? "-"} style={{ width: "12rem" }} />
            <Column field="userName" header="Inserito da" style={{ width: "12rem" }} />
            <Column field="note" header="Nota" />
          </DataTable>
        </Panel>
      )}
    </div>
  );
}
