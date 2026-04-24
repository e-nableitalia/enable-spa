import { DataTable } from "primereact/datatable";
import { Column } from "primereact/column";
import { Button } from "primereact/button";
import { Tag } from "primereact/tag";
import { Calendar } from "primereact/calendar";
import { Dropdown } from "primereact/dropdown";
import { Toolbar } from "primereact/toolbar";
import { InputText } from "primereact/inputtext";
import { Tooltip } from "primereact/tooltip";
import { useNavigate } from "react-router-dom";
import { db, functions } from "../../firebase";
import { doc, getDoc, deleteDoc, collection, getDocs } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { useRef, useState, useEffect, useMemo } from "react";
import { Toast } from "primereact/toast";
import { Dialog } from "primereact/dialog";
import { MultiSelect } from "primereact/multiselect";
import { REQUEST_STATUSES, REQUEST_STATUS_SEVERITY, PUBLIC_STATUS_SEVERITY, shortAmputationType } from "../../helpers/requestStatus";
import { FilterMatchMode } from "primereact/api";
import type { DataTableFilterMeta } from "primereact/datatable";

interface AdminRequestTableProps {
  requests: any[];
}

export default function AdminRequestTable({ requests }: AdminRequestTableProps) {
  const navigate = useNavigate();
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
    navigate(`/admin/request/${id}`);
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
      <Button
        icon="pi pi-search"
        onClick={() => handleOpen(row.id)}
        rounded
        text
      />
      <Button
        icon="pi pi-trash"
        className="p-button-danger"
        onClick={() => handleDelete(row.id)}
        rounded
        text
      />
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

  // Stato dei filtri — persistito in sessionStorage per sopravvivere alla navigazione
  const SESSION_KEY = "adminRequestTableFilters";

  const defaultFilters: DataTableFilterMeta = {
    status: { value: null, matchMode: FilterMatchMode.IN },
    firstName: { value: null, matchMode: FilterMatchMode.CONTAINS },
    lastName: { value: null, matchMode: FilterMatchMode.CONTAINS },
    age: { value: null, matchMode: FilterMatchMode.EQUALS },
    gender: { value: null, matchMode: FilterMatchMode.IN },
    amputationType: { value: null, matchMode: FilterMatchMode.IN },
    deviceType: { value: null, matchMode: FilterMatchMode.IN },
    publicStatus: { value: null, matchMode: FilterMatchMode.IN },
    province: { value: null, matchMode: FilterMatchMode.CONTAINS },
    recipient: { value: null, matchMode: FilterMatchMode.CONTAINS },
    assignedVolunteersText: { value: null, matchMode: FilterMatchMode.CONTAINS },
    seqId: { value: null, matchMode: FilterMatchMode.CONTAINS },
    requestNumber: { value: null, matchMode: FilterMatchMode.CONTAINS },
    createdAt: { value: null, matchMode: FilterMatchMode.DATE_IS },
    updatedAt: { value: null, matchMode: FilterMatchMode.DATE_IS },
    requiresAttention: { value: null, matchMode: FilterMatchMode.EQUALS },
  };

  const loadFilters = (): DataTableFilterMeta => {
    try {
      const saved = sessionStorage.getItem(SESSION_KEY);
      if (!saved) return defaultFilters;
      const parsed = JSON.parse(saved);
      // Ripristina i Date serializzati come stringa per i campi data
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
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(filters));
    } catch {
      // sessionStorage non disponibile
    }
  }, [filters]);

  const SORT_KEY = "adminRequestTableSort";
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
    { key: "updatedAt",              label: "Aggiornato il" },
  ];

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

  // Multiselect filter template for status
  const statusFilterTemplate = (options: any) => (
    <MultiSelect
      value={options.value || []}
      options={REQUEST_STATUSES.map(s => ({ label: s, value: s }))}
      onChange={(e) => {
        // Aggiorna i filtri con il valore selezionato
        setFilters((prev: any) => ({
          ...prev,
          status: { value: e.value, matchMode: FilterMatchMode.IN }
        }));
        options.filterCallback(e.value, options.index);
      }}
      placeholder="Filtra stati"
      display="chip"
      style={{ minWidth: 180 }}
    />
  );

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
        style={{ minWidth: 140 }}
      />
    );

  const setTextFilter = (field: string, value: string, matchMode = FilterMatchMode.CONTAINS) =>
    setFilters((prev) => ({ ...prev, [field]: { value: value || null, matchMode } }));

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
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
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
              style={{ minWidth: 200 }}
            />
            <Button
              label="Bulk Change"
              icon="pi pi-pencil"
              onClick={() => setShowBulkDialog(true)}
              disabled={selectedRows.length === 0}
            />
          </div>
        }
      />
      {/* Search bar testo libero */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 10 }}>
        <span className="p-input-icon-left" style={{ flex: "0 1 180px" }}>
          <i className="pi pi-search" style={{ left: "0.75rem" }} />
          <InputText
            value={(filters.seqId as any)?.value ?? ""}
            onChange={(e) => setTextFilter("seqId", e.target.value)}
            placeholder="ID"
            style={{ paddingLeft: "2rem", width: "100%" }}
          />
        </span>
        {([
          { field: "requestNumber",          placeholder: "Seq" },
          { field: "firstName",              placeholder: "Nome" },
          { field: "lastName",               placeholder: "Cognome" },
          { field: "recipient",              placeholder: "Destinatario" },
        ] as { field: string; placeholder: string }[]).map(({ field, placeholder }) => (
          <span key={field} className="p-input-icon-left" style={{ flex: "1 1 130px" }}>
            <i className="pi pi-search" style={{ left: "0.75rem" }} />
            <InputText
              value={(filters[field] as any)?.value ?? ""}
              onChange={(e) => setTextFilter(field, e.target.value)}
              placeholder={placeholder}
              style={{ paddingLeft: "2rem", width: "100%" }}
            />
          </span>
        ))}
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
        {([
          { field: "province",               placeholder: "Provincia" },
          { field: "assignedVolunteersText", placeholder: "Volontari" },
        ] as { field: string; placeholder: string }[]).map(({ field, placeholder }) => (
          <span key={field} className="p-input-icon-left" style={{ flex: "1 1 130px" }}>
            <i className="pi pi-search" style={{ left: "0.75rem" }} />
            <InputText
              value={(filters[field] as any)?.value ?? ""}
              onChange={(e) => setTextFilter(field, e.target.value)}
              placeholder={placeholder}
              style={{ paddingLeft: "2rem", width: "100%" }}
            />
          </span>
        ))}
      </div>
      <DataTable
        value={tableData}
        paginator
        rows={20}
        rowsPerPageOptions={[10, 20, 50, tableData.length]}
        paginatorTemplate="RowsPerPageDropdown FirstPageLink PrevPageLink PageLinks NextPageLink LastPageLink CurrentPageReport"
        currentPageReportTemplate="Mostrati {first}-{last} di {totalRecords}"
        filterDisplay="row"
        filters={filters}
        onFilter={(e) => setFilters(e.filters)}
        sortField={sortField}
        sortOrder={sortOrder}
        onSort={handleSort}
        selection={selectedRows}
        onSelectionChange={e => setSelectedRows(e.value as RequestRow[])}
        dataKey="id"
        scrollable
        scrollHeight="flex"
      >
        <Column selectionMode="multiple" style={{ width: "3rem" }} />
        <Column
          header="Copia ID"
          body={(row) => (
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
        />
        <Column field="seqId" header="ID" sortable style={{ width: "55px" }} />
        <Column
          field="requiresAttention"
          header="⚠️ Attenzione"
          sortable
          filter
          showFilterMenu={false}
          filterMatchMode={FilterMatchMode.EQUALS}
          filterElement={(options) => (
            <Dropdown
              value={options.value}
              options={[
                { label: "Tutti", value: null },
                { label: "Sì", value: true },
                { label: "No", value: false },
              ]}
              onChange={(e) => {
                setFilters((prev) => ({ ...prev, requiresAttention: { value: e.value, matchMode: FilterMatchMode.EQUALS } }));
                options.filterCallback(e.value, options.index);
              }}
              placeholder="Filtra"
              style={{ minWidth: 100 }}
            />
          )}
          body={(row) => row.requiresAttention
            ? <span title="Richiede attenzione" style={{ color: "#ef4444", fontWeight: 700, fontSize: 18 }}>&#9888;</span>
            : null
          }
          style={{ width: "90px", textAlign: "center" }}
        />
        {col("requestNumber") && <Column field="requestNumber" header="Seq" sortable style={{ width: "65px" }} />}
        {col("firstName") && <Column field="firstName" header="Nome" sortable style={{ width: "90px" }} />}
        {col("lastName") && <Column field="lastName" header="Cognome" sortable style={{ width: "100px" }} />}
        {col("recipient") && <Column field="recipient" header="Destinatario" sortable style={{ width: "110px" }} />}
        {col("age") && <Column field="age" header="Età" sortable style={{ width: "55px" }} />}
        {col("gender") && (
          <Column
            field="gender"
            header="Genere"
            filter
            sortable
            filterElement={makeMultiSelectFilter("gender", genderOptions, "Filtra genere")}
            showFilterMenu={false}
            filterMatchMode={FilterMatchMode.IN}
            style={{ width: "90px" }}
          />
        )}
        {col("amputationType") && (
          <Column
            field="amputationType"
            header="Tipo amputazione"
            sortable
            filter
            filterElement={makeMultiSelectFilter("amputationType", amputationTypeOptions, "Filtra amputazione")}
            showFilterMenu={false}
            filterMatchMode={FilterMatchMode.IN}
            body={(row) => (
              <span title={row.amputationType}>{shortAmputationType(row.amputationType)}</span>
            )}
            style={{ width: "120px" }}
          />
        )}
        {col("deviceType") && (
          <Column
            field="deviceType"
            header="Device"
            filter
            sortable
            filterElement={makeMultiSelectFilter("deviceType", deviceTypeOptions, "Filtra device")}
            showFilterMenu={false}
            filterMatchMode={FilterMatchMode.IN}
            style={{ width: "110px" }}
          />
        )}
        {col("status") && (
          <Column
            field="status"
            header="Stato"
            filter
            sortable
            filterElement={statusFilterTemplate}
            showFilterMenu={false}
            filterField="status"
            filterMatchMode={FilterMatchMode.IN}
            body={statusTemplate}
            style={{ width: "130px" }}
          />
        )}
        {col("publicStatus") && (
          <Column
            header="Stato Pubblico"
            body={publicStatusTemplate}
            filter
            field="publicStatus"
            sortable
            filterElement={(options) => (
              <MultiSelect
                value={options.value || []}
                options={Object.keys(PUBLIC_STATUS_SEVERITY).map(s => ({ label: s, value: s }))}
                onChange={(e) => {
                  setFilters((prev: DataTableFilterMeta) => ({
                    ...prev,
                    publicStatus: { value: e.value, matchMode: FilterMatchMode.IN }
                  }));
                  options.filterCallback(e.value, options.index);
                }}
                placeholder="Filtra stato pubblico"
                display="chip"
                style={{ minWidth: 140 }}
              />
            )}
            showFilterMenu={false}
            filterMatchMode={FilterMatchMode.IN}
            style={{ width: "140px" }}
          />
        )}
        {col("province") && <Column field="province" header="Provincia" sortable style={{ width: "75px" }} />}
        {col("assignedVolunteersText") && (
          <Column
            field="assignedVolunteersText"
            header="Volontari"
            body={assignedVolunteersTemplate}
            sortable
            style={{ width: "130px" }}
          />
        )}
        <Column
          field="createdAt"
          header="Creato il"
          body={(row) => dateTemplate(row, "createdAt")}
          filter
          dataType="date"
          filterElement={dateFilterTemplate}
          sortable
          style={{ width: "110px" }}
        />
        {col("updatedAt") && (
          <Column
            field="updatedAt"
            header="Aggiornato il"
            body={(row) => dateTemplate(row, "updatedAt")}
            filter
            dataType="date"
            filterElement={dateFilterTemplate}
            sortable
            style={{ width: "120px" }}
          />
        )}
        <Column body={actionTemplate} style={{ width: "80px" }} />
      </DataTable>
      {/* Tooltip component for PrimeReact */}
      <span style={{ display: "none" }}>
        {/* This ensures PrimeReact tooltips are initialized */}
        <Button tooltip="Tooltip" />
      </span>
    </>
  );
}
