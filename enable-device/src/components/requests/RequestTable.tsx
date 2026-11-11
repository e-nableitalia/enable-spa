import { DataTable } from "primereact/datatable";
import { Column } from "primereact/column";
import { Button } from "primereact/button";
import { Tag } from "primereact/tag";
import { useState, useMemo } from "react";
import { REQUEST_STATUS_SEVERITY, PUBLIC_STATUS_SEVERITY, getPublicStatusGroup } from "../../helpers/requestStatus";
import RequestFiltersPanel from "./RequestFiltersPanel";
import { applyRequestFilters, useRequestListFilters, useVisibleColumns } from "./requestListFilters";

interface Props {
  requests: any[];
  onOpen: (id: string) => void;
  /** Usata solo per l'ordinamento (per vista); filtri e colonne sono condivisi tra le viste. */
  sessionKey?: string;
  compact?: boolean;
  selectedRequestId?: string | null;
}

// Chiavi di sessionStorage condivise da tutte le viste volontario
const FILTERS_KEY = "volunteerRequestListFilters";
const COLS_KEY = "volunteerRequestListCols";

const TOGGLEABLE_COLS = [
  { key: "firstName",    label: "Nome" },
  { key: "lastName",     label: "Cognome" },
  { key: "age",          label: "Età" },
  { key: "province",     label: "Provincia" },
  { key: "deviceType",   label: "Device" },
  { key: "status",       label: "Stato" },
  { key: "publicStatus", label: "Stato Pubblico" },
  { key: "createdAt",    label: "Creata" },
  { key: "updatedAt",    label: "Modificata" },
];
const ALL_COL_KEYS = TOGGLEABLE_COLS.map((c) => c.key);
const COMPACT_DEFAULT_COLS = ["firstName", "lastName", "deviceType", "status", "publicStatus", "updatedAt"];

// Larghezze in px: usate sia per le colonne sia per il min-width della tabella (scroll orizzontale)
const COLUMN_WIDTHS: Record<string, number> = {
  rowActions: 110,
  firstName: 120,
  lastName: 130,
  age: 60,
  province: 90,
  deviceType: 130,
  status: 150,
  publicStatus: 170,
  createdAt: 150,
  updatedAt: 150,
};

export default function RequestTable({
  requests,
  onOpen,
  sessionKey = "requestTableFilters",
  compact = false,
  selectedRequestId = null,
}: Props) {
  const { filters, setFilter, reset } = useRequestListFilters(FILTERS_KEY);
  const [visibleCols, setVisibleCols] = useVisibleColumns(
    COLS_KEY,
    ALL_COL_KEYS,
    compact ? COMPACT_DEFAULT_COLS : ALL_COL_KEYS
  );
  const col = (key: string) => visibleCols.includes(key);

  const sortStorageKey = sessionKey + "_sort";
  const loadSort = (): { field: string; order: 1 | -1 } => {
    try {
      const saved = sessionStorage.getItem(sortStorageKey);
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
      sessionStorage.setItem(sortStorageKey, JSON.stringify({ field, order }));
    } catch { /* ignore */ }
  };

  const statusTemplate = (row: any) => (
    <Tag value={row.publicStatus} severity={PUBLIC_STATUS_SEVERITY[row.publicStatus] ?? "secondary"} />
  );

  const internalStatusTemplate = (row: any) => (
    <Tag value={row.status} severity={REQUEST_STATUS_SEVERITY[row.status] ?? "secondary"} />
  );

  const actionTemplate = (row: any) => (
    <Button
      label="Open"
      icon="pi pi-search"
      onClick={() => onOpen(row.id)}
    />
  );

  // Mappa i dati per convertire i campi data in oggetti Date e ricalcolare lo stato pubblico da status (EA-150)
  const tableData = requests.map((r) => ({
    ...r,
    publicStatus: getPublicStatusGroup(r.status || ""),
    createdAt: r.createdAt?.toDate ? r.createdAt.toDate() : null,
    updatedAt: r.updatedAt?.toDate ? r.updatedAt.toDate() : null,
  }));

  const filteredData = applyRequestFilters(tableData, filters);

  const dateTemplate = (row: any, field: "createdAt" | "updatedAt") => {
    const date = row[field];
    return date ? date.toLocaleString() : "-";
  };

  const deviceTypeOptions = useMemo(() => {
    const unique = [...new Set(requests.map((r) => r.deviceType).filter(Boolean))] as string[];
    return unique.sort().map((d) => ({ label: d, value: d }));
  }, [requests]);

  const statusOptions = useMemo(() => {
    const unique = [...new Set(requests.map((r) => r.status).filter(Boolean))] as string[];
    return unique.sort().map((s) => ({ label: s, value: s }));
  }, [requests]);

  const publicStatusOptions = useMemo(() => {
    const unique = [...new Set(requests.map((r) => getPublicStatusGroup(r.status || "")).filter(Boolean))] as string[];
    return unique.sort().map((s) => ({ label: s, value: s }));
  }, [requests]);

  const tableMinWidth =
    (compact ? 0 : COLUMN_WIDTHS.rowActions) +
    visibleCols.reduce((sum, k) => sum + (COLUMN_WIDTHS[k] ?? 0), 0);

  return (
    <div>
      <RequestFiltersPanel
        scope="volunteer"
        filters={filters}
        onChange={setFilter}
        onReset={reset}
        statusOptions={statusOptions}
        publicStatusOptions={publicStatusOptions}
        deviceTypeOptions={deviceTypeOptions}
        columns={TOGGLEABLE_COLS}
        visibleColumns={visibleCols}
        onVisibleColumnsChange={setVisibleCols}
      />
      <DataTable
        value={filteredData}
        paginator
        rows={10}
        rowsPerPageOptions={[10, 20, 50, filteredData.length].filter((v, i, a) => v > 0 && a.indexOf(v) === i)}
        paginatorTemplate="RowsPerPageDropdown FirstPageLink PrevPageLink PageLinks NextPageLink LastPageLink CurrentPageReport"
        currentPageReportTemplate="Mostrati {first}-{last} di {totalRecords}"
        emptyMessage="Nessuna richiesta corrisponde ai filtri."
        sortField={sortField}
        sortOrder={sortOrder}
        onSort={handleSort}
        onRowClick={compact ? (e) => onOpen((e.data as any).id) : undefined}
        rowClassName={(rowData) =>
          compact && selectedRequestId && (rowData as any).id === selectedRequestId ? "p-highlight" : ""
        }
        size={compact ? "small" : undefined}
        scrollable
        tableStyle={{ minWidth: tableMinWidth }}
      >
        {col("firstName") && <Column field="firstName" header="Nome" sortable style={{ width: COLUMN_WIDTHS.firstName }} />}
        {col("lastName") && <Column field="lastName" header="Cognome" sortable style={{ width: COLUMN_WIDTHS.lastName }} />}
        {col("age") && <Column field="age" header="Età" sortable style={{ width: COLUMN_WIDTHS.age }} />}
        {col("province") && <Column field="province" header="Provincia" sortable style={{ width: COLUMN_WIDTHS.province }} />}
        {col("deviceType") && <Column field="deviceType" header="Device" sortable style={{ width: COLUMN_WIDTHS.deviceType }} />}
        {col("status") && (
          <Column field="status" header="Stato" sortable body={internalStatusTemplate} style={{ width: COLUMN_WIDTHS.status }} />
        )}
        {col("publicStatus") && (
          <Column field="publicStatus" header="Stato Pubblico" sortable body={statusTemplate} style={{ width: COLUMN_WIDTHS.publicStatus }} />
        )}
        {col("createdAt") && (
          <Column
            field="createdAt"
            header="Creata"
            sortable
            body={(row) => dateTemplate(row, "createdAt")}
            style={{ width: COLUMN_WIDTHS.createdAt }}
          />
        )}
        {col("updatedAt") && (
          <Column
            field="updatedAt"
            header="Modificata"
            sortable
            body={(row) => dateTemplate(row, "updatedAt")}
            style={{ width: COLUMN_WIDTHS.updatedAt }}
          />
        )}
        {!compact && <Column body={actionTemplate} style={{ width: COLUMN_WIDTHS.rowActions }} />}
      </DataTable>
    </div>
  );
}
