import { DataTable } from "primereact/datatable";
import { Column } from "primereact/column";
import { Button } from "primereact/button";
import { Tag } from "primereact/tag";
import { Dropdown } from "primereact/dropdown";
import { Toolbar } from "primereact/toolbar";
import { Tooltip } from "primereact/tooltip";
import { useLocation, useNavigate } from "react-router-dom";
import { db, functions } from "../../firebase";
import { doc, getDoc, deleteDoc, collection, getDocs } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { useRef, useState, useEffect, useMemo } from "react";
import { Toast } from "primereact/toast";
import { Dialog } from "primereact/dialog";
import { REQUEST_STATUSES, REQUEST_STATUS_SEVERITY, PUBLIC_STATUS_SEVERITY, shortAmputationType, getPublicStatusGroup } from "../../helpers/requestStatus";
import RequestFiltersPanel from "./RequestFiltersPanel";
import { applyRequestFilters, useRequestListFilters, useVisibleColumns } from "./requestListFilters";

// Chiavi di sessionStorage condivise da tutte le viste admin: i filtri e le colonne
// restano quando si cambia pagina o vista delle richieste.
const FILTERS_KEY = "adminRequestListFilters";
const COLS_KEY = "adminRequestTableCols";

const TOGGLEABLE_COLS = [
  { key: "requestNumber",          label: "Seq" },
  { key: "firstName",              label: "Nome" },
  { key: "lastName",               label: "Cognome" },
  { key: "recipient",              label: "Destinatario" },
  { key: "age",                    label: "Età" },
  { key: "gender",                 label: "Genere" },
  { key: "amputationType",         label: "Tipo amputazione" },
  { key: "deviceType",             label: "Device" },
  { key: "status",                 label: "Stato" },
  { key: "publicStatus",           label: "Stato Pubblico" },
  { key: "province",               label: "Provincia" },
  { key: "assignedVolunteersText", label: "Volontari" },
  { key: "createdAt",              label: "Creato il" },
  { key: "updatedAt",              label: "Aggiornato il" },
];
const ALL_COL_KEYS = TOGGLEABLE_COLS.map((c) => c.key);
// Con il dettaglio affiancato la lista parte con meno colonne (modificabili dall'utente)
const COMPACT_DEFAULT_COLS = ["firstName", "lastName", "deviceType", "status", "publicStatus", "updatedAt"];

// Larghezze in px: usate sia per le colonne sia per il min-width della tabella (scroll orizzontale)
const COLUMN_WIDTHS: Record<string, number> = {
  select: 48,
  open: 100,
  openCompact: 60,
  seqId: 65,
  attention: 90,
  rowActions: 80,
  requestNumber: 65,
  firstName: 120,
  lastName: 130,
  recipient: 120,
  age: 60,
  gender: 90,
  amputationType: 130,
  deviceType: 130,
  status: 150,
  publicStatus: 170,
  province: 90,
  assignedVolunteersText: 170,
  createdAt: 150,
  updatedAt: 150,
};

interface AdminRequestTableProps {
  requests: any[];
  detailBasePath?: string;
  compact?: boolean;
  onOpenRequest?: (id: string) => void;
  selectedRequestId?: string | null;
}

export default function AdminRequestTable({
  requests,
  detailBasePath = "/admin/requests",
  compact = false,
  onOpenRequest,
  selectedRequestId = null,
}: AdminRequestTableProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useRef<Toast>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [selectedRows, setSelectedRows] = useState<RequestRow[]>([]);
  const [showBulkDialog, setShowBulkDialog] = useState(false);
  const [bulkStatus, setBulkStatus] = useState<string | null>(null);
  const [bulkLoading, setBulkLoading] = useState(false);
  const [volunteerNames, setVolunteerNames] = useState<Record<string, string>>({});

  // Resolve all unique volunteer UIDs appearing in the table to full names
  useEffect(() => {
    const allUids = [
      ...new Set(
        requests.flatMap((r) => (r.assignedVolunteers ?? []) as string[])
      ),
    ];
    if (allUids.length === 0) return;
    const missing = allUids.filter((uid) => !volunteerNames[uid]);
    if (missing.length === 0) return;
    Promise.all(
      missing.map(async (uid) => {
        const snap = await getDoc(doc(db, "users", uid, "private", "profile"));
        if (snap.exists()) {
          const d = snap.data();
          const name = `${d.firstName ?? ""} ${d.lastName ?? ""}`.trim();
          return [uid, name || uid] as [string, string];
        }
        return [uid, uid] as [string, string];
      })
    ).then((entries) => {
      setVolunteerNames((prev) => ({ ...prev, ...Object.fromEntries(entries) }));
    });
    // volunteerNames intentionally omitted to avoid infinite loop
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requests]);

  const handleOpen = (id: string) => {
    if (onOpenRequest) {
      onOpenRequest(id);
      return;
    }
    navigate(`${detailBasePath}/${id}`, {
      state: { from: `${location.pathname}${location.search}` },
    });
  };

  const handleDelete = (id: string) => {
    setDeleteId(id);
  };

  const confirmDelete = async () => {
    if (!deleteId) return;
    setDeleteLoading(true);
    try {
      await deleteDoc(doc(db, "deviceRequests", deleteId, "private", "data"));
      const eventsCol = collection(db, "deviceRequests", deleteId, "events");
      const eventsSnap = await getDocs(eventsCol);
      const deletePromises = eventsSnap.docs.map((evDoc) => deleteDoc(evDoc.ref));
      await Promise.all(deletePromises);
      await deleteDoc(doc(db, "deviceRequests", deleteId));
      await deleteDoc(doc(db, "publicDeviceRequests", deleteId));
      toast.current?.show({
        severity: "success",
        summary: "Eliminazione",
        detail: "Richiesta eliminata con successo.",
        life: 3000,
      });
    } catch (err: unknown) {
      toast.current?.show({
        severity: "error",
        summary: "Errore",
        detail: "Errore durante l'eliminazione: " + (err instanceof Error ? err.message : String(err)),
        life: 4000,
      });
    } finally {
      setDeleteLoading(false);
      setDeleteId(null);
    }
  };

  const cancelDelete = () => {
    setDeleteId(null);
    setDeleteLoading(false);
  };

  const actionTemplate = (row: any) => (
    <div style={{ display: "flex", flexDirection: "row", gap: "0.5rem" }}>
      {!compact && (
        <Button
          icon="pi pi-trash"
          className="p-button-danger"
          onClick={() => handleDelete(row.id)}
          rounded
          text
        />
      )}
    </div>
  );

  interface RequestRow {
    id: string;
    status: string;
    publicStatus?: string;
    [key: string]: any;
  }

  const handleBulkChange = async () => {
    if (!bulkStatus || !selectedRows.length) return;
    setBulkLoading(true);
    const changeStatusFn = httpsCallable(functions, "changeStatus");
    let ok = 0, err = 0;
    for (const row of selectedRows) {
      try {
        await changeStatusFn({ requestId: row.id, newStatus: bulkStatus, note: "Bulk change" });
        ok++;
      } catch {
        err++;
      }
    }
    setBulkLoading(false);
    setShowBulkDialog(false);
    setBulkStatus(null);
    setSelectedRows([]);
    toast.current?.show({
      severity: err === 0 ? "success" : "warn",
      summary: "Bulk Change completato",
      detail: `Aggiornati: ${ok}${err > 0 ? `, Errori: ${err}` : ""}`,
      life: 4000,
    });
  };

  const statusTemplate = (row: RequestRow) => (
    <Tag value={row.status} severity={REQUEST_STATUS_SEVERITY[row.status]} />
  );

  const publicStatusTemplate = (row: RequestRow) => (
    <Tag
      value={row.publicStatus}
      severity={row.publicStatus ? PUBLIC_STATUS_SEVERITY[row.publicStatus] : "info"}
    />
  );

  const tableData = requests.map((r) => ({
    ...r,
    // Stato pubblico display-only, ricalcolato al volo da status (EA-150)
    publicStatus: getPublicStatusGroup(r.status || ""),
    createdAt: r.createdAt?.toDate ? r.createdAt.toDate() : null,
    updatedAt: r.updatedAt?.toDate ? r.updatedAt.toDate() : null,
    // Campo derivato per il filtro: array di UID → nomi ricercabili
    assignedVolunteersText: (r.assignedVolunteers ?? [] as string[])
      .map((uid: string) => volunteerNames[uid] ?? uid)
      .join(", "),
  }));

  const dateTemplate = (row: any, field: "createdAt" | "updatedAt") => {
    const date = row[field];
    return date ? date.toLocaleString() : "-";
  };

  const SORT_KEY = "adminRequestTableSort";

  // Filtri e colonne condivisi tra tutte le viste admin (persistiti in sessionStorage)
  const { filters, setFilter, reset } = useRequestListFilters(FILTERS_KEY);
  const [visibleCols, setVisibleCols] = useVisibleColumns(
    COLS_KEY,
    ALL_COL_KEYS,
    compact ? COMPACT_DEFAULT_COLS : ALL_COL_KEYS
  );
  const col = (key: string) => visibleCols.includes(key);

  const loadSort = (): { field: string; order: 1 | -1 } => {
    try {
      const saved = sessionStorage.getItem(SORT_KEY);
      if (saved) return JSON.parse(saved);
    } catch { /* ignore */ }
    return { field: "updatedAt", order: -1 };
  };
  const [sortField, setSortField] = useState<string>(loadSort().field);
  const [sortOrder, setSortOrder] = useState<1 | -1>(loadSort().order);

  const handleSort = (e: { sortField: string; sortOrder: 0 | 1 | -1 | null | undefined }) => {
    const field = e.sortField ?? "updatedAt";
    const order = (e.sortOrder ?? -1) as 1 | -1;
    setSortField(field);
    setSortOrder(order);
    try {
      sessionStorage.setItem(SORT_KEY, JSON.stringify({ field, order }));
    } catch { /* ignore */ }
  };


  const MAX_VOLUNTEER_CHIPS = 2;

  const assignedVolunteersTemplate = (row: any) => {
    const volunteers: string[] = row.assignedVolunteers ?? [];
    if (volunteers.length === 0) return <span style={{ color: "#aaa" }}>—</span>;

    const visible = volunteers.slice(0, MAX_VOLUNTEER_CHIPS);
    const hidden = volunteers.slice(MAX_VOLUNTEER_CHIPS);
    const tooltipId = `vols-${row.id}`;
    const hiddenNames = hidden.map((uid: string) => volunteerNames[uid] ?? uid);

    return (
      <div style={{ display: "flex", flexWrap: "wrap", gap: 4, alignItems: "center" }}>
        {visible.map((uid: string) => (
          <Tag
            key={uid}
            value={volunteerNames[uid] ?? uid.slice(0, 8) + "…"}
            severity="info"
            title={uid}
            style={{ fontSize: 11, cursor: "default" }}
          />
        ))}
        {hidden.length > 0 && (
          <>
            <Tooltip target={`#${tooltipId}`} content={hiddenNames.join("\n")} position="top" />
            <Tag
              id={tooltipId}
              value={`+${hidden.length}`}
              severity="secondary"
              style={{ fontSize: 11, cursor: "default" }}
            />
          </>
        )}
      </div>
    );
  };

  const deviceTypeOptions = useMemo(() => {
    const unique = [...new Set(requests.map((r) => r.deviceType).filter(Boolean))] as string[];
    return unique.slice().sort((a: string, b: string) => a.localeCompare(b)).map((d: string) => ({ label: d, value: d }));
  }, [requests]);

  const genderOptions = useMemo(() => {
    const unique = [...new Set(requests.map((r) => r.gender).filter(Boolean))] as string[];
    return unique.slice().sort((a: string, b: string) => a.localeCompare(b)).map((g: string) => ({ label: g, value: g }));
  }, [requests]);

  const amputationTypeOptions = useMemo(() => {
    const unique = [...new Set(requests.map((r) => r.amputationType).filter(Boolean))] as string[];
    return unique.slice().sort((a: string, b: string) => a.localeCompare(b)).map((v: string) => ({ label: v, value: v }));
  }, [requests]);


  const filteredData = applyRequestFilters(tableData, filters);

  const tableMinWidth =
    (compact ? COLUMN_WIDTHS.openCompact : COLUMN_WIDTHS.open + COLUMN_WIDTHS.select + COLUMN_WIDTHS.rowActions) +
    COLUMN_WIDTHS.seqId +
    COLUMN_WIDTHS.attention +
    visibleCols.reduce((sum, k) => sum + (COLUMN_WIDTHS[k] ?? 0), 0);

  return (
    <>
      <Toast ref={toast} />
      <Dialog
        header="Conferma eliminazione"
        visible={!!deleteId}
        style={{ width: "400px" }}
        modal
        onHide={cancelDelete}
        footer={
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <Button label="Annulla" className="p-button-text" onClick={cancelDelete} disabled={deleteLoading} />
            <Button label="Elimina" className="p-button-danger" onClick={confirmDelete} loading={deleteLoading} />
          </div>
        }
      >
        <div>
          Sei sicuro di voler eliminare questa richiesta?<br />
          <strong>ID:</strong> {deleteId}
        </div>
      </Dialog>
      <Dialog
        header="Bulk Change stato"
        visible={showBulkDialog}
        style={{ width: "360px" }}
        modal
        onHide={() => { setShowBulkDialog(false); setBulkStatus(null); }}
        footer={
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <Button
              label="Annulla"
              className="p-button-text"
              onClick={() => { setShowBulkDialog(false); setBulkStatus(null); }}
              disabled={bulkLoading}
            />
            <Button
              label="Applica"
              onClick={handleBulkChange}
              disabled={!bulkStatus || bulkLoading}
              loading={bulkLoading}
            />
          </div>
        }
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <span>Selezionate: <strong>{selectedRows.length}</strong> richieste</span>
          <Dropdown
            value={bulkStatus}
            options={REQUEST_STATUSES.map(s => ({ label: s, value: s }))}
            onChange={e => setBulkStatus(e.value)}
            placeholder="Scegli nuovo stato"
            style={{ width: "100%" }}
          />
        </div>
      </Dialog>
      {!compact && (
        <Toolbar
          style={{ marginBottom: 8 }}
          start={
            <span style={{ fontSize: 14 }}>
              {selectedRows.length > 0
                ? `${selectedRows.length} richieste selezionate`
                : "Nessuna richiesta selezionata"}
            </span>
          }
          end={
            <Button
              label="Bulk Change"
              icon="pi pi-pencil"
              onClick={() => setShowBulkDialog(true)}
              disabled={selectedRows.length === 0}
            />
          }
        />
      )}
      <RequestFiltersPanel
        scope="admin"
        filters={filters}
        onChange={setFilter}
        onReset={reset}
        statusOptions={REQUEST_STATUSES.map((s) => ({ label: s, value: s }))}
        publicStatusOptions={Object.keys(PUBLIC_STATUS_SEVERITY).map((s) => ({ label: s, value: s }))}
        deviceTypeOptions={deviceTypeOptions}
        genderOptions={genderOptions}
        amputationTypeOptions={amputationTypeOptions}
        columns={TOGGLEABLE_COLS}
        visibleColumns={visibleCols}
        onVisibleColumnsChange={setVisibleCols}
      />
      <DataTable
        value={filteredData}
        paginator
        rows={20}
        rowsPerPageOptions={[10, 20, 50, filteredData.length].filter((v, i, a) => v > 0 && a.indexOf(v) === i)}
        paginatorTemplate="RowsPerPageDropdown FirstPageLink PrevPageLink PageLinks NextPageLink LastPageLink CurrentPageReport"
        currentPageReportTemplate="Mostrati {first}-{last} di {totalRecords}"
        emptyMessage="Nessuna richiesta corrisponde ai filtri."
        sortField={sortField}
        sortOrder={sortOrder}
        onSort={handleSort}
        selection={compact ? undefined : selectedRows}
        onSelectionChange={compact ? undefined : (e => setSelectedRows(e.value as RequestRow[]))}
        onRowClick={compact ? (e) => handleOpen((e.data as RequestRow).id) : undefined}
        dataKey="id"
        scrollable
        scrollHeight="flex"
        tableStyle={{ minWidth: tableMinWidth }}
        size={compact ? "small" : undefined}
        rowClassName={(rowData) =>
          compact && selectedRequestId && (rowData as RequestRow).id === selectedRequestId
            ? "p-highlight"
            : ""
        }
      >
        {!compact && <Column selectionMode="multiple" style={{ width: COLUMN_WIDTHS.select }} />}
        <Column
          body={(row) => (
            <div style={{ display: "flex", flexDirection: "row", gap: "0.5rem" }}>
              <Button
                icon="pi pi-search"
                tooltip="Dettaglio"
                tooltipOptions={{ position: "top" }}
                onClick={() => handleOpen(row.id)}
                rounded
                text
              />
              {!compact && (
                <Button
                  icon="pi pi-copy"
                  tooltip="Copia ID"
                  tooltipOptions={{ position: "top" }}
                  rounded
                  text
                  onClick={async () => {
                    await navigator.clipboard.writeText(row.id);
                    toast.current?.show({
                      severity: "info",
                      summary: "ID copiato",
                      detail: `ID ${row.id} copiato negli appunti.`,
                      life: 2000,
                    });
                  }}
                />
              )}
            </div>
          )}
          style={{ width: compact ? COLUMN_WIDTHS.openCompact : COLUMN_WIDTHS.open }}
        />
        <Column field="seqId" header="ID" sortable style={{ width: COLUMN_WIDTHS.seqId }} />
        <Column
          field="requiresAttention"
          header="⚠️ Attenzione"
          sortable
          body={(row) => row.requiresAttention
            ? <span title="Richiede attenzione" style={{ color: "#ef4444", fontWeight: 700, fontSize: 18 }}>&#9888;</span>
            : null
          }
          style={{ width: COLUMN_WIDTHS.attention, textAlign: "center" }}
        />
        {col("requestNumber") && <Column field="requestNumber" header="Seq" sortable style={{ width: COLUMN_WIDTHS.requestNumber }} />}
        {col("firstName") && <Column field="firstName" header="Nome" sortable style={{ width: COLUMN_WIDTHS.firstName }} />}
        {col("lastName") && <Column field="lastName" header="Cognome" sortable style={{ width: COLUMN_WIDTHS.lastName }} />}
        {col("recipient") && <Column field="recipient" header="Destinatario" sortable style={{ width: COLUMN_WIDTHS.recipient }} />}
        {col("age") && <Column field="age" header="Età" sortable style={{ width: COLUMN_WIDTHS.age }} />}
        {col("gender") && <Column field="gender" header="Genere" sortable style={{ width: COLUMN_WIDTHS.gender }} />}
        {col("amputationType") && (
          <Column
            field="amputationType"
            header="Tipo amputazione"
            sortable
            body={(row) => (
              <span title={row.amputationType}>{shortAmputationType(row.amputationType)}</span>
            )}
            style={{ width: COLUMN_WIDTHS.amputationType }}
          />
        )}
        {col("deviceType") && <Column field="deviceType" header="Device" sortable style={{ width: COLUMN_WIDTHS.deviceType }} />}
        {col("status") && <Column field="status" header="Stato" sortable body={statusTemplate} style={{ width: COLUMN_WIDTHS.status }} />}
        {col("publicStatus") && (
          <Column
            field="publicStatus"
            header="Stato Pubblico"
            sortable
            body={publicStatusTemplate}
            style={{ width: COLUMN_WIDTHS.publicStatus }}
          />
        )}
        {col("province") && <Column field="province" header="Provincia" sortable style={{ width: COLUMN_WIDTHS.province }} />}
        {col("assignedVolunteersText") && (
          <Column
            field="assignedVolunteersText"
            header="Volontari"
            body={assignedVolunteersTemplate}
            sortable
            style={{ width: COLUMN_WIDTHS.assignedVolunteersText }}
          />
        )}
        {col("createdAt") && (
          <Column
            field="createdAt"
            header="Creato il"
            body={(row) => dateTemplate(row, "createdAt")}
            sortable
            style={{ width: COLUMN_WIDTHS.createdAt }}
          />
        )}
        {col("updatedAt") && (
          <Column
            field="updatedAt"
            header="Aggiornato il"
            body={(row) => dateTemplate(row, "updatedAt")}
            sortable
            style={{ width: COLUMN_WIDTHS.updatedAt }}
          />
        )}
        {!compact && <Column body={actionTemplate} style={{ width: COLUMN_WIDTHS.rowActions }} />}
      </DataTable>
      {/* Tooltip component for PrimeReact */}
      <span style={{ display: "none" }}>
        {/* This ensures PrimeReact tooltips are initialized */}
        <Button tooltip="Tooltip" />
      </span>
    </>
  );
}
