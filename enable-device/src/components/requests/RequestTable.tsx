import { DataTable } from "primereact/datatable";
import { Column } from "primereact/column";
import { Button } from "primereact/button";
import { Tag } from "primereact/tag";
import { Calendar } from "primereact/calendar";
import { MultiSelect } from "primereact/multiselect";
import { InputText } from "primereact/inputtext";
import { useState, useEffect, useMemo } from "react";
import { FilterMatchMode } from "primereact/api";
import type { DataTableFilterMeta } from "primereact/datatable";
import { REQUEST_STATUS_SEVERITY, PUBLIC_STATUS_SEVERITY } from "../../helpers/requestStatus";

interface Props {
  requests: any[];
  onOpen: (id: string) => void;
  sessionKey?: string;
}

export default function RequestTable({ requests, onOpen, sessionKey = "requestTableFilters" }: Props) {

  console.log("Rendering RequestTable with requests:", requests);

  const defaultFilters: DataTableFilterMeta = {
    firstName: { value: null, matchMode: FilterMatchMode.CONTAINS },
    lastName: { value: null, matchMode: FilterMatchMode.CONTAINS },
    age: { value: null, matchMode: FilterMatchMode.EQUALS },
    province: { value: null, matchMode: FilterMatchMode.CONTAINS },
    deviceType: { value: null, matchMode: FilterMatchMode.IN },
    status: { value: null, matchMode: FilterMatchMode.IN },
    publicStatus: { value: null, matchMode: FilterMatchMode.IN },
    createdAt: { value: null, matchMode: FilterMatchMode.DATE_IS },
    updatedAt: { value: null, matchMode: FilterMatchMode.DATE_IS },
  };

  const loadFilters = (): DataTableFilterMeta => {
    try {
      const saved = sessionStorage.getItem(sessionKey);
      if (!saved) return defaultFilters;
      const parsed = JSON.parse(saved);
      for (const field of ["createdAt", "updatedAt"] as const) {
        const f = parsed[field];
        if (f?.value) f.value = new Date(f.value);
      }
      return { ...defaultFilters, ...parsed };
    } catch {
      return defaultFilters;
    }
  };

  const [filters, setFilters] = useState<DataTableFilterMeta>(loadFilters);

  useEffect(() => {
    try {
      sessionStorage.setItem(sessionKey, JSON.stringify(filters));
    } catch {
      // sessionStorage non disponibile
    }
  }, [filters, sessionKey]);

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

  const handleSort = (e: { sortField: string; sortOrder: 1 | -1 | null | undefined }) => {
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

  // Mappa i dati per convertire i campi data in oggetti Date
  const tableData = requests.map((r) => ({
    ...r,
    createdAt: r.createdAt?.toDate ? r.createdAt.toDate() : null,
    updatedAt: r.updatedAt?.toDate ? r.updatedAt.toDate() : null,
  }));

  // Template per formattare le date
  const dateTemplate = (row: any, field: "createdAt" | "updatedAt") => {
    const date = row[field];
    return date ? date.toLocaleString() : "-";
  };

  // Template per il filtro data
  const dateFilterTemplate = (options: any) => (
    <Calendar
      value={options.value}
      onChange={(e) => options.filterCallback(e.value, options.index)}
      dateFormat="dd/mm/yy"
      placeholder="gg/mm/aaaa"
      mask="99/99/9999"
      showIcon
    />
  );

  const deviceTypeOptions = useMemo(() => {
    const unique = [...new Set(requests.map((r) => r.deviceType).filter(Boolean))] as string[];
    return unique.sort().map((d) => ({ label: d, value: d }));
  }, [requests]);

  const statusOptions = useMemo(() => {
    const unique = [...new Set(requests.map((r) => r.status).filter(Boolean))] as string[];
    return unique.sort().map((s) => ({ label: s, value: s }));
  }, [requests]);

  const publicStatusOptions = useMemo(() => {
    const unique = [...new Set(requests.map((r) => r.publicStatus).filter(Boolean))] as string[];
    return unique.sort().map((s) => ({ label: s, value: s }));
  }, [requests]);

  const makeMultiSelectFilter = (field: string, opts: { label: string; value: string }[], placeholder: string) =>
    (options: any) => (
      <MultiSelect
        value={options.value || []}
        options={opts}
        onChange={(e) => {
          setFilters((prev) => ({
            ...prev,
            [field]: { value: e.value, matchMode: FilterMatchMode.IN },
          }));
          options.filterCallback(e.value, options.index);
        }}
        placeholder={placeholder}
        display="chip"
        style={{ minWidth: 160 }}
      />
    );

  return (
    <div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginBottom: 12 }}>
        <span className="p-input-icon-left" style={{ flex: "1 1 160px" }}>
          <i className="pi pi-search" style={{ left: "0.75rem" }} />
          <InputText
            value={(filters.firstName as any)?.value ?? ""}
            onChange={(e) => setFilters((prev) => ({ ...prev, firstName: { value: e.target.value || null, matchMode: FilterMatchMode.CONTAINS } }))}
            placeholder="Nome"
            style={{ paddingLeft: "2rem", width: "100%" }}
          />
        </span>
        <span className="p-input-icon-left" style={{ flex: "1 1 160px" }}>
          <i className="pi pi-search" style={{ left: "0.75rem" }} />
          <InputText
            value={(filters.lastName as any)?.value ?? ""}
            onChange={(e) => setFilters((prev) => ({ ...prev, lastName: { value: e.target.value || null, matchMode: FilterMatchMode.CONTAINS } }))}
            placeholder="Cognome"
            style={{ paddingLeft: "2rem", width: "100%" }}
          />
        </span>
        <span className="p-input-icon-left" style={{ flex: "0 1 180px" }}>
          <i className="pi pi-search" style={{ left: "0.75rem" }} />
          <InputText
            value={(filters.age as any)?.value ?? ""}
            onChange={(e) => setFilters((prev) => ({ ...prev, age: { value: e.target.value ? Number(e.target.value) : null, matchMode: FilterMatchMode.EQUALS } }))}
            placeholder="Età"
            type="number"
            style={{ paddingLeft: "2rem", width: "100%" }}
          />
        </span>
        <span className="p-input-icon-left" style={{ flex: "1 1 140px" }}>
          <i className="pi pi-search" style={{ left: "0.75rem" }} />
          <InputText
            value={(filters.province as any)?.value ?? ""}
            onChange={(e) => setFilters((prev) => ({ ...prev, province: { value: e.target.value || null, matchMode: FilterMatchMode.CONTAINS } }))}
            placeholder="Provincia"
            style={{ paddingLeft: "2rem", width: "100%" }}
          />
        </span>
      </div>
      <DataTable
        value={tableData}
        paginator
        rows={10}
        rowsPerPageOptions={[10, 20, 50, tableData.length]}
        paginatorTemplate="RowsPerPageDropdown FirstPageLink PrevPageLink PageLinks NextPageLink LastPageLink CurrentPageReport"
        currentPageReportTemplate="Mostrati {first}-{last} di {totalRecords}"
        filterDisplay="row"
        filters={filters}
        onFilter={(e) => setFilters(e.filters)}
        sortField={sortField}
        sortOrder={sortOrder}
        onSort={handleSort}
      >
        <Column field="firstName" header="Nome" sortable />
        <Column field="lastName" header="Cognome" sortable />
        <Column field="age" header="Età" sortable />
        <Column field="province" header="Provincia" sortable />
        <Column
          field="deviceType"
          header="Device"
          sortable
          filter
          filterElement={makeMultiSelectFilter("deviceType", deviceTypeOptions, "Filtra device")}
          showFilterMenu={false}
          filterMatchMode={FilterMatchMode.IN}
        />
        <Column
          field="status"
          header="Stato"
          sortable
          body={internalStatusTemplate}
          filter
          filterElement={makeMultiSelectFilter("status", statusOptions, "Filtra stato")}
          showFilterMenu={false}
          filterMatchMode={FilterMatchMode.IN}
        />
        <Column
          header="Stato Pubblico"
          sortable
          body={statusTemplate}
          filter
          field="publicStatus"
          filterElement={makeMultiSelectFilter("publicStatus", publicStatusOptions, "Filtra stato pubblico")}
          showFilterMenu={false}
          filterMatchMode={FilterMatchMode.IN}
        />
        <Column
          header="Creata"
          sortable
          body={(row) => dateTemplate(row, "createdAt")}
          filter
          field="createdAt"
          dataType="date"
          filterElement={dateFilterTemplate}
        />
        <Column
          header="Modificata"
          sortable
          body={(row) => dateTemplate(row, "updatedAt")}
          filter
          field="updatedAt"
          dataType="date"
          filterElement={dateFilterTemplate}
        />
        <Column body={actionTemplate} />
      </DataTable>
    </div>
  );
}
