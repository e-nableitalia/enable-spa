import { useEffect, useMemo, useRef, useState } from "react";
import { collection, getDocs, limit, orderBy, query } from "firebase/firestore";
import { db } from "../../firebase";
import { DataTable } from "primereact/datatable";
import { Column } from "primereact/column";
import { Button } from "primereact/button";
import { Dialog } from "primereact/dialog";
import { Dropdown } from "primereact/dropdown";
import { InputText } from "primereact/inputtext";
import { Tag } from "primereact/tag";
import { Toast } from "primereact/toast";
import { ProgressSpinner } from "primereact/progressspinner";

// ---- Types ----

interface Actor {
  uid?: string;
  email?: string;
  ip?: string;
  provider?: string;
}

interface Context {
  function?: string;
  metadata?: Record<string, unknown>;
}

interface SecurityLog {
  id: string;
  action?: string;
  actor?: Actor;
  context?: Context;
  createdAt?: unknown;
  outcome?: "success" | "failure" | string;
  severity?: "low" | "medium" | "high" | string;
  type?: string;
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
  const sec = String(d.getSeconds()).padStart(2, "0");
  return `${dd}/${mm}/${yyyy} ${hh}:${min}:${sec}`;
}

function shortUid(uid: string | undefined): string {
  if (!uid) return "—";
  return uid.length > 12 ? `${uid.slice(0, 8)}…` : uid;
}

type TagSeverity = "success" | "info" | "warning" | "danger" | "secondary" | "contrast";

function getSeverityColor(severity: string | undefined): TagSeverity {
  switch (severity) {
    case "low": return "info";
    case "medium": return "warning";
    case "high": return "danger";
    default: return "secondary";
  }
}

function getOutcomeColor(outcome: string | undefined): TagSeverity {
  switch (outcome) {
    case "success": return "success";
    case "failure": return "danger";
    default: return "secondary";
  }
}

// ---- Filter defaults ----

interface Filters {
  severity: string;
  outcome: string;
  action: string;
  actorEmail: string;
}

const DEFAULT_FILTERS: Filters = {
  severity: "",
  outcome: "",
  action: "",
  actorEmail: "",
};

const SEVERITY_OPTIONS = [
  { label: "Tutti", value: "" },
  { label: "Low", value: "low" },
  { label: "Medium", value: "medium" },
  { label: "High", value: "high" },
];

const OUTCOME_OPTIONS = [
  { label: "Tutti", value: "" },
  { label: "Success", value: "success" },
  { label: "Failure", value: "failure" },
];

// ---- Component ----

export default function AdminSecurityLogsPage() {
  const toast = useRef<Toast>(null);
  const [logs, setLogs] = useState<SecurityLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<SecurityLog | null>(null);
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);

  useEffect(() => {
    const fetchLogs = async () => {
      try {
        const q = query(
          collection(db, "securityLogs"),
          orderBy("createdAt", "desc"),
          limit(50)
        );
        const snap = await getDocs(q);
        const data = snap.docs.map((d) => ({
          id: d.id,
          ...d.data(),
        })) as SecurityLog[];
        setLogs(data);
      } catch (e: unknown) {
        const msg =
          e instanceof Error
            ? e.message
            : "Errore nel caricamento dei log di sicurezza.";
        toast.current?.show({
          severity: "error",
          summary: "Errore",
          detail: msg,
          life: 5000,
        });
      } finally {
        setLoading(false);
      }
    };
    fetchLogs();
  }, []);

  // Pre-process dates for sortable columns
  const tableData = useMemo(
    () =>
      logs.map((l) => ({
        ...l,
        createdAt: toDate(l.createdAt),
      })),
    [logs]
  );

  // Client-side filtering
  const filteredData = useMemo(() => {
    return tableData.filter((l) => {
      if (filters.severity && l.severity !== filters.severity) return false;
      if (filters.outcome && l.outcome !== filters.outcome) return false;
      if (
        filters.action &&
        !l.action?.toLowerCase().includes(filters.action.toLowerCase())
      )
        return false;
      if (
        filters.actorEmail &&
        !l.actor?.email
          ?.toLowerCase()
          .includes(filters.actorEmail.toLowerCase())
      )
        return false;
      return true;
    });
  }, [tableData, filters]);

  const setFilter = <K extends keyof Filters>(key: K, value: Filters[K]) =>
    setFilters((f) => ({ ...f, [key]: value }));

  // ---- Column bodies ----

  const dateBody = (row: SecurityLog) => formatDate(row.createdAt);

  const actionBody = (row: SecurityLog) => (
    <span style={{ fontFamily: "monospace", fontSize: "0.85em" }}>
      {row.action ?? "—"}
    </span>
  );

  const emailBody = (row: SecurityLog) => row.actor?.email ?? "—";

  const uidBody = (row: SecurityLog) => (
    <span
      title={row.actor?.uid}
      style={{ fontFamily: "monospace", fontSize: "0.85em", cursor: "default" }}
    >
      {shortUid(row.actor?.uid)}
    </span>
  );

  const severityBody = (row: SecurityLog) => (
    <Tag value={row.severity ?? "—"} severity={getSeverityColor(row.severity)} />
  );

  const outcomeBody = (row: SecurityLog) => (
    <Tag value={row.outcome ?? "—"} severity={getOutcomeColor(row.outcome)} />
  );

  const functionBody = (row: SecurityLog) => (
    <span style={{ fontFamily: "monospace", fontSize: "0.85em" }}>
      {row.context?.function ?? "—"}
    </span>
  );

  const actionsBody = (row: SecurityLog) => (
    <Button
      icon="pi pi-eye"
      label="Dettagli"
      size="small"
      className="p-button-text"
      onClick={() => setSelected(row)}
    />
  );

  // ---- Detail dialog ----

  const renderDetail = () => {
    if (!selected) return null;

    const field = (label: string, value: React.ReactNode) => (
      <div style={{ marginBottom: 8 }}>
        <strong style={{ display: "inline-block", minWidth: 120 }}>{label}:</strong>
        <span style={{ marginLeft: 8 }}>{value ?? "—"}</span>
      </div>
    );

    return (
      <div>
        {/* General */}
        <h4 style={{ margin: "0 0 10px", color: "#333" }}>Generale</h4>
        {field("Azione", <span style={{ fontFamily: "monospace" }}>{selected.action}</span>)}
        {field("Data", formatDate(selected.createdAt))}
        {field("Tipo", selected.type)}
        {field("Severity", <Tag value={selected.severity ?? "—"} severity={getSeverityColor(selected.severity)} />)}
        {field("Outcome", <Tag value={selected.outcome ?? "—"} severity={getOutcomeColor(selected.outcome)} />)}

        {/* Actor */}
        <hr style={{ margin: "14px 0", borderColor: "#eee" }} />
        <h4 style={{ margin: "0 0 10px", color: "#333" }}>Actor</h4>
        {field("Email", selected.actor?.email)}
        {field(
          "UID",
          <span style={{ fontFamily: "monospace", fontSize: "0.9em" }}>
            {selected.actor?.uid ?? "—"}
          </span>
        )}
        {field("IP", selected.actor?.ip)}
        {field("Provider", selected.actor?.provider)}

        {/* Context */}
        {selected.context && (
          <>
            <hr style={{ margin: "14px 0", borderColor: "#eee" }} />
            <h4 style={{ margin: "0 0 10px", color: "#333" }}>Contesto</h4>
            {field("Funzione", <span style={{ fontFamily: "monospace" }}>{selected.context.function}</span>)}
            {selected.context.metadata && (
              <div style={{ marginBottom: 8 }}>
                <strong>Metadata:</strong>
                <pre
                  style={{
                    background: "#f6f8fa",
                    border: "1px solid #ddd",
                    borderRadius: 4,
                    padding: 10,
                    marginTop: 6,
                    fontSize: "0.82em",
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-all",
                    maxHeight: 260,
                    overflowY: "auto",
                  }}
                >
                  {JSON.stringify(selected.context.metadata, null, 2)}
                </pre>
              </div>
            )}
          </>
        )}
      </div>
    );
  };

  // ---- Loading ----

  if (loading) {
    return (
      <div style={{ display: "flex", justifyContent: "center", padding: 60 }}>
        <ProgressSpinner />
      </div>
    );
  }

  // ---- Main render ----

  return (
    <div style={{ padding: 20 }}>
      <Toast ref={toast} />

      <h2 style={{ marginBottom: 20 }}>Security Logs</h2>

      {/* Filter bar */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 12,
          alignItems: "flex-end",
          marginBottom: 16,
          padding: "12px 16px",
          background: "#f4f4f4",
          borderRadius: 6,
        }}
      >
        <div>
          <label style={{ display: "block", fontSize: "0.8em", marginBottom: 4 }}>
            Severity
          </label>
          <Dropdown
            value={filters.severity}
            options={SEVERITY_OPTIONS}
            optionValue="value"
            onChange={(e) => setFilter("severity", e.value)}
            placeholder="Tutti"
            style={{ width: 140 }}
          />
        </div>

        <div>
          <label style={{ display: "block", fontSize: "0.8em", marginBottom: 4 }}>
            Outcome
          </label>
          <Dropdown
            value={filters.outcome}
            options={OUTCOME_OPTIONS}
            optionValue="value"
            onChange={(e) => setFilter("outcome", e.value)}
            placeholder="Tutti"
            style={{ width: 140 }}
          />
        </div>

        <div>
          <label style={{ display: "block", fontSize: "0.8em", marginBottom: 4 }}>
            Azione
          </label>
          <InputText
            value={filters.action}
            onChange={(e) => setFilter("action", e.target.value)}
            placeholder="Filtra per azione…"
            style={{ width: 200 }}
          />
        </div>

        <div>
          <label style={{ display: "block", fontSize: "0.8em", marginBottom: 4 }}>
            Email actor
          </label>
          <InputText
            value={filters.actorEmail}
            onChange={(e) => setFilter("actorEmail", e.target.value)}
            placeholder="Filtra per email…"
            style={{ width: 200 }}
          />
        </div>

        <Button
          label="Reset filtri"
          icon="pi pi-filter-slash"
          className="p-button-outlined p-button-secondary"
          onClick={() => setFilters(DEFAULT_FILTERS)}
        />
      </div>

      <DataTable
        value={filteredData}
        emptyMessage="Nessun log trovato."
        paginator
        rows={20}
        sortField="createdAt"
        sortOrder={-1}
        dataKey="id"
      >
        <Column
          field="createdAt"
          header="Data"
          body={dateBody}
          sortable
          style={{ minWidth: 160 }}
        />
        <Column
          field="action"
          header="Azione"
          body={actionBody}
          sortable
          style={{ minWidth: 160 }}
        />
        <Column
          header="Email actor"
          body={emailBody}
          style={{ minWidth: 160 }}
        />
        <Column
          header="UID"
          body={uidBody}
          style={{ minWidth: 110 }}
        />
        <Column
          field="severity"
          header="Severity"
          body={severityBody}
          sortable
          style={{ minWidth: 100 }}
        />
        <Column
          field="outcome"
          header="Outcome"
          body={outcomeBody}
          sortable
          style={{ minWidth: 100 }}
        />
        <Column
          header="Funzione"
          body={functionBody}
          style={{ minWidth: 140 }}
        />
        <Column
          header="Azioni"
          body={actionsBody}
          style={{ minWidth: 110 }}
        />
      </DataTable>

      <Dialog
        header="Dettagli log di sicurezza"
        visible={!!selected}
        style={{ width: "640px" }}
        contentStyle={{ maxHeight: "70vh", overflowY: "auto" }}
        onHide={() => setSelected(null)}
        footer={
          <Button
            label="Chiudi"
            icon="pi pi-times"
            className="p-button-text"
            onClick={() => setSelected(null)}
          />
        }
      >
        {renderDetail()}
      </Dialog>
    </div>
  );
}
