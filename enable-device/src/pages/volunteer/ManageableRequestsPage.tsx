import { useEffect, useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { getDocs, collection } from "firebase/firestore";
import { db } from "../../firebase";
import { DataTable } from "primereact/datatable";
import { Column } from "primereact/column";
import { MultiSelect } from "primereact/multiselect";
import { InputText } from "primereact/inputtext";
import { FilterMatchMode } from "primereact/api";
import type { DataTableFilterMeta } from "primereact/datatable";
import { Button } from "primereact/button";

const SESSION_KEY = "manageableRequestsFilters";
const SORT_KEY = "manageableRequestsSort";

const defaultFilters: DataTableFilterMeta = {
  requestNumber: { value: null, matchMode: FilterMatchMode.CONTAINS },
  ageRange: { value: null, matchMode: FilterMatchMode.CONTAINS },
  devicetype: { value: null, matchMode: FilterMatchMode.IN },
  province: { value: null, matchMode: FilterMatchMode.CONTAINS },
};

function loadFilters(): DataTableFilterMeta {
  try {
    const saved = sessionStorage.getItem(SESSION_KEY);
    if (!saved) return defaultFilters;
    return { ...defaultFilters, ...JSON.parse(saved) };
  } catch {
    return defaultFilters;
  }
}

function loadSort() {
  try {
    const saved = sessionStorage.getItem(SORT_KEY);
    if (saved) return JSON.parse(saved);
  } catch { /* ignore */ }
  return { field: "createdAt", order: 1 as 1 | -1 };
}

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
  return d.toLocaleDateString("it-IT", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export default function ManageableRequestsPage() {
  const navigate = useNavigate();
  const [requests, setRequests] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState<DataTableFilterMeta>(loadFilters);
  const sortInit = loadSort();
  const [sortField, setSortField] = useState<string>(sortInit.field);
  const [sortOrder, setSortOrder] = useState<1 | -1>(sortInit.order);

  // Search bar state (text fields)
  const [searchSeq, setSearchSeq] = useState<string>(
    (defaultFilters.requestNumber as any)?.value ?? ""
  );
  const [searchAgeRange, setSearchAgeRange] = useState<string>(
    (defaultFilters.ageRange as any)?.value ?? ""
  );
  const [searchProvince, setSearchProvince] = useState<string>(
    (defaultFilters.province as any)?.value ?? ""
  );

  useEffect(() => {
    const fetchRequests = async () => {
      try {
        const snap = await getDocs(collection(db, "publicDeviceRequests"));
        const all = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        setRequests(all.filter((r: any) => r.publicStatus === "da gestire"));
      } finally {
        setLoading(false);
      }
    };
    fetchRequests();
  }, []);

  const deviceTypeOptions = useMemo(
    () => [...new Set(requests.map((r) => r.devicetype).filter(Boolean))].map((v) => ({ label: v, value: v })),
    [requests]
  );

  function setTextFilter(field: string, value: string) {
    const updated = {
      ...filters,
      [field]: { value: value || null, matchMode: FilterMatchMode.CONTAINS },
    };
    setFilters(updated);
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(updated));
  }

  function handleFilter(e: any) {
    setFilters(e.filters);
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(e.filters));
  }

  function handleSort(e: any) {
    setSortField(e.sortField);
    setSortOrder(e.sortOrder);
    sessionStorage.setItem(SORT_KEY, JSON.stringify({ field: e.sortField, order: e.sortOrder }));
  }

  const makeMultiSelectFilter = (field: string, opts: { label: string; value: string }[], placeholder: string) => (
    options: any
  ) => (
    <MultiSelect
      value={options.value}
      options={opts}
      onChange={(e) => options.filterCallback(e.value)}
      placeholder={placeholder}
      maxSelectedLabels={1}
      style={{ minWidth: "10rem", maxWidth: "14rem" }}
      showClear
    />
  );

  if (loading) {
    return (
      <div style={{ textAlign: "center", marginTop: 80 }}>
        <span className="pi pi-spin pi-spinner" style={{ fontSize: 32 }} />
      </div>
    );
  }

  return (
    <div style={{ width: "100%" }}>
      <h2>Richieste da gestire ({requests.length})</h2>

      {/* Search bar */}
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 12, alignItems: "flex-end" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <label style={{ fontSize: "0.85em", fontWeight: 500 }}>Seq</label>
          <InputText
            value={searchSeq}
            onChange={(e) => {
              setSearchSeq(e.target.value);
              setTextFilter("requestNumber", e.target.value);
            }}
            placeholder="Cerca seq..."
            style={{ width: 120 }}
          />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <label style={{ fontSize: "0.85em", fontWeight: 500 }}>Fascia d'età</label>
          <InputText
            value={searchAgeRange}
            onChange={(e) => {
              setSearchAgeRange(e.target.value);
              setTextFilter("ageRange", e.target.value);
            }}
            placeholder="Cerca fascia..."
            style={{ width: 160 }}
          />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <label style={{ fontSize: "0.85em", fontWeight: 500 }}>Provincia</label>
          <InputText
            value={searchProvince}
            onChange={(e) => {
              setSearchProvince(e.target.value);
              setTextFilter("province", e.target.value);
            }}
            placeholder="Cerca provincia..."
            style={{ width: 140 }}
          />
        </div>
        <Button
          icon="pi pi-filter-slash"
          label="Resetta filtri"
          className="p-button-outlined p-button-secondary"
          style={{ height: 38, alignSelf: "flex-end" }}
          onClick={() => {
            setFilters(defaultFilters);
            setSearchSeq("");
            setSearchAgeRange("");
            setSearchProvince("");
            sessionStorage.removeItem(SESSION_KEY);
          }}
        />
      </div>

      <DataTable
        value={requests}
        paginator
        rows={10}
        rowsPerPageOptions={[10, 20, 50, requests.length]}
        paginatorTemplate="RowsPerPageDropdown FirstPageLink PrevPageLink PageLinks NextPageLink LastPageLink CurrentPageReport"
        currentPageReportTemplate="Mostrati {first}-{last} di {totalRecords}"
        filters={filters}
        onFilter={handleFilter}
        filterDisplay="row"
        sortField={sortField}
        sortOrder={sortOrder}
        onSort={handleSort}
        emptyMessage="Nessuna richiesta da gestire."
        onRowClick={(e) => navigate(`/volunteer/manageable-requests/${e.data.id}`)}
        rowHover
        style={{ cursor: "pointer" }}
      >
        <Column field="requestNumber" header="Seq" sortable filter filterPlaceholder="Seq" style={{ width: "7rem" }} />
        <Column field="ageRange" header="Fascia d'età" sortable filter filterPlaceholder="Fascia" />
        <Column
          field="devicetype"
          header="Device"
          sortable
          filter
          filterElement={makeMultiSelectFilter("devicetype", deviceTypeOptions, "Device")}
          showFilterMenu={false}
        />
        <Column field="province" header="Provincia" sortable filter filterPlaceholder="Provincia" style={{ width: "9rem" }} />
        <Column
          field="createdAt"
          header="Data creazione"
          sortable
          body={(row) => formatDate(row.createdAt)}
          style={{ width: "11rem" }}
        />
        <Column
          header=""
          style={{ width: "5rem", textAlign: "center" }}
          body={(row) => (
            <Button
              icon="pi pi-eye"
              className="p-button-text p-button-sm"
              onClick={(e) => { e.stopPropagation(); navigate(`/volunteer/manageable-requests/${row.id}`); }}
              tooltip="Visualizza"
              tooltipOptions={{ position: "left" }}
            />
          )}
        />
      </DataTable>
    </div>
  );
}
