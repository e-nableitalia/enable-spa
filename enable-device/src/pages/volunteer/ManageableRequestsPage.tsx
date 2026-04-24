import { useEffect, useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { getDocs, collection, getDoc, doc, query, where } from "firebase/firestore";
import { db } from "../../firebase";
import { PUBLIC_STATUS_GROUPS } from "../../helpers/requestStatus";
import { DataTable } from "primereact/datatable";
import { Column } from "primereact/column";
import { MultiSelect } from "primereact/multiselect";
import { InputText } from "primereact/inputtext";
import { FilterMatchMode } from "primereact/api";
import type { DataTableFilterMeta } from "primereact/datatable";
import { Button } from "primereact/button";

const SESSION_KEY = "manageableRequestsFilters";
const SORT_KEY = "manageableRequestsSort";
const COLS_KEY = "manageableRequestsCols";

const TOGGLEABLE_COLS = [
  { key: "requestNumber",    label: "Seq" },
  { key: "ageRange",         label: "Fascia d'età" },
  { key: "devicetype",       label: "Device" },
  { key: "province",         label: "Provincia" },
  { key: "recipient",        label: "Destinatario" },
  { key: "relation",         label: "Relazione" },
  { key: "descriptionPublic",label: "Descrizione" },
  { key: "preferencesPublic",label: "Preferenze" },
  { key: "createdAt",        label: "Data creazione" },
];

const defaultFilters: DataTableFilterMeta = {
  requestNumber: { value: null, matchMode: FilterMatchMode.CONTAINS },
  ageRange: { value: null, matchMode: FilterMatchMode.IN },
  devicetype: { value: null, matchMode: FilterMatchMode.IN },
  province: { value: null, matchMode: FilterMatchMode.CONTAINS },
  recipient: { value: null, matchMode: FilterMatchMode.CONTAINS },
  relation: { value: null, matchMode: FilterMatchMode.CONTAINS },
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

  const loadVisibleCols = (): string[] => {
    try {
      const saved = sessionStorage.getItem(COLS_KEY);
      if (saved) return JSON.parse(saved);
    } catch { /* ignore */ }
    return TOGGLEABLE_COLS.map((c) => c.key);
  };
  const [visibleCols, setVisibleCols] = useState<string[]>(loadVisibleCols);
  const handleVisibleCols = (keys: string[]) => {
    setVisibleCols(keys);
    try { sessionStorage.setItem(COLS_KEY, JSON.stringify(keys)); } catch { /* ignore */ }
  };
  const col = (key: string) => visibleCols.includes(key);
  const [searchSeq, setSearchSeq] = useState<string>(
    (defaultFilters.requestNumber as any)?.value ?? ""
  );
  const [searchAgeRange, setSearchAgeRange] = useState<string[]>(
    (defaultFilters.ageRange as any)?.value ?? []
  );
  const [searchDeviceType, setSearchDeviceType] = useState<string[]>(
    (defaultFilters.devicetype as any)?.value ?? []
  );
  const [searchProvince, setSearchProvince] = useState<string>(
    (defaultFilters.province as any)?.value ?? ""
  );
  const [searchRecipient, setSearchRecipient] = useState<string>(
    (defaultFilters.recipient as any)?.value ?? ""
  );
  const [searchRelation, setSearchRelation] = useState<string>(
    (defaultFilters.relation as any)?.value ?? ""
  );

  useEffect(() => {
    const fetchRequests = async () => {
      try {
        const daGestireStatuses = PUBLIC_STATUS_GROUPS["da gestire"];
        const q = query(
          collection(db, "deviceRequests"),
          where("assignedVolunteers", "==", []),
          where("status", "in", daGestireStatuses)
        );
        const snap = await getDocs(q);
        const base = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

        // Enrich with public fields (requestNumber, ageRange, devicetype, province, publicStatus)
        const enriched = await Promise.all(
          base.map(async (r: any) => {
            try {
              const pubSnap = await getDoc(doc(db, "publicDeviceRequests", r.id));
              if (pubSnap.exists()) {
                const pub = pubSnap.data();
                return {
                  ...r,
                  requestNumber: pub.requestNumber ?? null,
                  ageRange: pub.ageRange ?? null,
                  devicetype: pub.devicetype ?? null,
                  province: pub.province ?? r.province ?? null,
                  publicStatus: pub.publicStatus ?? null,
                };
              }
            } catch { /* permission denied or missing — skip */ }
            return r;
          })
        );
        setRequests(enriched);
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

  const ageRangeOptions = useMemo(
    () => [...new Set(requests.map((r) => r.ageRange).filter(Boolean))].sort().map((v) => ({ label: v, value: v })),
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
          <MultiSelect
            value={searchAgeRange}
            options={ageRangeOptions}
            onChange={(e) => {
              setSearchAgeRange(e.value ?? []);
              const updated = { ...filters, ageRange: { value: e.value?.length ? e.value : null, matchMode: FilterMatchMode.IN } };
              setFilters(updated);
              sessionStorage.setItem(SESSION_KEY, JSON.stringify(updated));
            }}
            placeholder="Fascia d'età"
            maxSelectedLabels={1}
            showClear
            style={{ width: 160 }}
          />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <label style={{ fontSize: "0.85em", fontWeight: 500 }}>Device</label>
          <MultiSelect
            value={searchDeviceType}
            options={deviceTypeOptions}
            onChange={(e) => {
              setSearchDeviceType(e.value ?? []);
              const updated = { ...filters, devicetype: { value: e.value?.length ? e.value : null, matchMode: FilterMatchMode.IN } };
              setFilters(updated);
              sessionStorage.setItem(SESSION_KEY, JSON.stringify(updated));
            }}
            placeholder="Device"
            maxSelectedLabels={1}
            showClear
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
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <label style={{ fontSize: "0.85em", fontWeight: 500 }}>Destinatario</label>
          <InputText
            value={searchRecipient}
            onChange={(e) => {
              setSearchRecipient(e.target.value);
              setTextFilter("recipient", e.target.value);
            }}
            placeholder="Cerca destinatario..."
            style={{ width: 160 }}
          />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <label style={{ fontSize: "0.85em", fontWeight: 500 }}>Relazione</label>
          <InputText
            value={searchRelation}
            onChange={(e) => {
              setSearchRelation(e.target.value);
              setTextFilter("relation", e.target.value);
            }}
            placeholder="Cerca relazione..."
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
            setSearchAgeRange([]);
            setSearchDeviceType([]);
            setSearchProvince("");
            setSearchRecipient("");
            setSearchRelation("");
            sessionStorage.removeItem(SESSION_KEY);
          }}
        />
        <MultiSelect
          value={visibleCols}
          options={TOGGLEABLE_COLS}
          optionLabel="label"
          optionValue="key"
          onChange={(e) => handleVisibleCols(e.value)}
          placeholder="Colonne visibili"
          maxSelectedLabels={0}
          selectedItemsLabel="{0} colonne visibili"
          display="chip"
          style={{ minWidth: 200, alignSelf: "flex-end" }}
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
        sortField={sortField}
        sortOrder={sortOrder}
        onSort={handleSort}
        emptyMessage="Nessuna richiesta da gestire."
        onRowClick={(e) => navigate(`/volunteer/manageable-requests/${e.data.id}`)}
        rowHover
        style={{ cursor: "pointer" }}
      >
        {col("requestNumber") && <Column field="requestNumber" header="Seq" sortable style={{ width: "7rem" }} />}
        {col("ageRange") && <Column field="ageRange" header="Fascia d'età" sortable style={{ width: "10rem" }} />}
        {col("devicetype") && <Column field="devicetype" header="Device" sortable style={{ width: "11rem" }} />}
        {col("province") && <Column field="province" header="Provincia" sortable style={{ width: "9rem" }} />}
        {col("recipient") && <Column field="recipient" header="Destinatario" sortable style={{ width: "11rem" }} />}
        {col("relation") && <Column field="relation" header="Relazione" sortable style={{ width: "10rem" }} />}
        {col("descriptionPublic") && (
          <Column
            field="descriptionPublic"
            header="Descrizione"
            sortable
            body={(row) => row.descriptionPublic
              ? <span title={row.descriptionPublic}>{row.descriptionPublic.length > 60 ? row.descriptionPublic.slice(0, 60) + "…" : row.descriptionPublic}</span>
              : "-"
            }
            style={{ width: "16rem" }}
          />
        )}
        {col("preferencesPublic") && (
          <Column
            field="preferencesPublic"
            header="Preferenze"
            sortable
            body={(row) => row.preferencesPublic
              ? <span title={row.preferencesPublic}>{row.preferencesPublic.length > 50 ? row.preferencesPublic.slice(0, 50) + "…" : row.preferencesPublic}</span>
              : "-"
            }
            style={{ width: "14rem" }}
          />
        )}
        {col("createdAt") && (
          <Column
            field="createdAt"
            header="Data creazione"
            sortable
            body={(row) => formatDate(row.createdAt)}
            style={{ width: "11rem" }}
          />
        )}
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
