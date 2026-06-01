import {DataTable} from "primereact/datatable";
import {Column} from "primereact/column";
import {Button} from "primereact/button";
import {Tag} from "primereact/tag";
import type {ProjectData} from "../../../shared/types/projectData";
import {asDateString} from "./taskHelpers";

interface Props {
  projects: ProjectData[];
  loading: boolean;
  onDetail: (project: ProjectData) => void;
  onEdit: (project: ProjectData) => void;
  onArchive: (project: ProjectData) => void;
}

function statusSeverity(status: ProjectData["status"]): "secondary" | "info" | "warning" | "success" {
  const map: Record<ProjectData["status"], "secondary" | "info" | "warning" | "success"> = {
    draft: "secondary",
    active: "info",
    paused: "warning",
    completed: "success",
    archived: "secondary",
  };
  return map[status];
}

export default function ProjectList({projects, loading, onDetail, onEdit, onArchive}: Readonly<Props>) {
  return (
    <DataTable value={projects} dataKey="id" paginator rows={10} loading={loading} emptyMessage="Nessun progetto trovato">
      <Column field="name" header="Nome" sortable />
      <Column field="status" header="Stato" body={(row: ProjectData) => <Tag value={row.status} severity={statusSeverity(row.status)} />} />
      <Column header="Volontari" body={(row: ProjectData) => row.volunteers.length} />
      <Column header="Riferimenti" body={(row: ProjectData) => row.referenceLinks.length} />
      <Column field="updatedAt" header="Aggiornato" body={(row: ProjectData) => asDateString(row.updatedAt)} sortable />
      <Column
        header="Azioni"
        body={(row: ProjectData) => (
          <div style={{display: "flex", gap: 4}}>
            <Button icon="pi pi-eye" className="p-button-text" onClick={() => onDetail(row)} />
            <Button icon="pi pi-pencil" className="p-button-text" onClick={() => onEdit(row)} />
            <Button icon="pi pi-box" className="p-button-text p-button-warning" onClick={() => onArchive(row)} />
          </div>
        )}
      />
    </DataTable>
  );
}
