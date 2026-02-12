import { DataTable } from "primereact/datatable";
import { Column } from "primereact/column";
import { Button } from "primereact/button";
import { Tag } from "primereact/tag";
import { Calendar } from "primereact/calendar";

interface Props {
  requests: any[];
  onOpen: (id: string) => void;
}

export default function RequestTable({ requests, onOpen }: Props) {
  const statusTemplate = (row: any) => (
    <Tag value={row.publicStatus} severity="info" />
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

  return (
    <DataTable value={tableData} paginator rows={10} filterDisplay="row">
      <Column field="province" header="Provincia" filter />
      <Column field="deviceType" header="Device" filter />
      <Column field="status" header="Stato Interno" filter />
      <Column
        header="Stato Pubblico"
        body={statusTemplate}
        filter
        field="publicStatus"
      />
      <Column
        header="Creata"
        body={(row) => dateTemplate(row, "createdAt")}
        filter
        field="createdAt"
        dataType="date"
        filterElement={dateFilterTemplate}
      />
      <Column
        header="Modificata"
        body={(row) => dateTemplate(row, "updatedAt")}
        filter
        field="updatedAt"
        dataType="date"
        filterElement={dateFilterTemplate}
      />
      <Column body={actionTemplate} />
    </DataTable>
  );
}
