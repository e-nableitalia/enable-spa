import { DataTable } from "primereact/datatable";
import { Column } from "primereact/column";
import { Button } from "primereact/button";
import { Tag } from "primereact/tag";
import { Calendar } from "primereact/calendar";
import { useNavigate } from "react-router-dom";
import { db } from "../../firebase";
import { doc, deleteDoc, collection, getDocs } from "firebase/firestore";
import { useRef, useState } from "react";
import { Toast } from "primereact/toast";
import { Dialog } from "primereact/dialog";
import { MultiSelect } from "primereact/multiselect";
import { REQUEST_STATUSES } from "../../helpers/requestStatus";
import { FilterMatchMode } from "primereact/api";
import type { DataTableFilterMeta } from "primereact/datatable";
import { REQUEST_STATUS_SEVERITY, PUBLIC_STATUS_SEVERITY, shortAmputationType } from "../../helpers/requestStatus";

interface AdminRequestTableProps {
  requests: any[];
}

export default function AdminRequestTable({ requests }: AdminRequestTableProps) {
  const navigate = useNavigate();
  const toast = useRef<Toast>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

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
      toast.current?.show({
        severity: "success",
        summary: "Eliminazione",
        detail: "Richiesta eliminata con successo.",
        life: 3000,
      });
      // ...opzionale: aggiorna la UI...
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

  // Stato dei filtri
  const [filters, setFilters] = useState<DataTableFilterMeta>({
    status: { value: null, matchMode: FilterMatchMode.IN },
    firstName: { value: null, matchMode: FilterMatchMode.CONTAINS },
    lastName: { value: null, matchMode: FilterMatchMode.CONTAINS },
    age: { value: null, matchMode: FilterMatchMode.EQUALS },
    gender: { value: null, matchMode: FilterMatchMode.EQUALS },
    amputationType: { value: null, matchMode: FilterMatchMode.CONTAINS },
    publicStatus: { value: null, matchMode: FilterMatchMode.EQUALS },
    province: { value: null, matchMode: FilterMatchMode.CONTAINS },
    createdAt: { value: null, matchMode: FilterMatchMode.DATE_IS },
    updatedAt: { value: null, matchMode: FilterMatchMode.DATE_IS },
  });

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
      <DataTable
        value={tableData}
        paginator
        rows={20}
        rowsPerPageOptions={[10, 20, 50, requests.length]}
        paginatorTemplate="RowsPerPageDropdown FirstPageLink PrevPageLink PageLinks NextPageLink LastPageLink"
        filterDisplay="row"
        filters={filters}
        onFilter={(e) => setFilters(e.filters)}
      >
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
        <Column field="firstName" header="Nome" filter sortable />
        <Column field="lastName" header="Cognome" filter sortable />
        <Column field="age" header="Età" filter sortable />
        <Column field="gender" header="Genere" filter sortable />
        <Column
          field="amputationType"
          header="Tipo amputazione"
          filter
          sortable
          body={(row) => (
            <>
              <span
                title={row.amputationType}
                data-pr-tooltip={row.amputationType}
                data-pr-position="top"
                className="amputation-type-tooltip"
              >
                {shortAmputationType(row.amputationType)}
              </span>
            </>
          )}
        />
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
        />
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
              style={{ minWidth: 180 }}
            />
          )}
          showFilterMenu={false}
          filterMatchMode={FilterMatchMode.IN}
        />
        <Column field="province" header="Provincia" filter sortable />
        <Column
          field="createdAt"
          header="Creato il"
          body={(row) => dateTemplate(row, "createdAt")}
          filter
          dataType="date"
          filterElement={dateFilterTemplate}
          sortable
        />
        <Column
          field="updatedAt"
          header="Aggiornato il"
          body={(row) => dateTemplate(row, "updatedAt")}
          filter
          dataType="date"
          filterElement={dateFilterTemplate}
          sortable
        />
        <Column body={actionTemplate} />
      </DataTable>
      {/* Tooltip component for PrimeReact */}
      <span style={{ display: "none" }}>
        {/* This ensures PrimeReact tooltips are initialized */}
        <Button tooltip="Tooltip" />
      </span>
    </>
  );
}
