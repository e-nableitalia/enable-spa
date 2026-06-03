import {DataTable} from "primereact/datatable";
import {Column} from "primereact/column";
import {Button} from "primereact/button";
import {Tag} from "primereact/tag";
import type {TaskData, TaskStatus} from "../../../shared/types/taskData";
import type {ProjectData} from "../../../shared/types/projectData";
import {
  assigneeLabel,
  asDateString,
  taskLinkedEntityLabel,
  taskPriorityLabel,
  taskPrioritySeverity,
  taskStatusLabel,
  taskStatusSeverity,
} from "./taskHelpers";
import TaskStatusActions from "./TaskStatusActions";

interface Props {
  tasks: TaskData[];
  projects: ProjectData[];
  loading: boolean;
  onDetail: (task: TaskData) => void;
  onEdit: (task: TaskData) => void;
  onDelete: (task: TaskData) => void;
  onAddNote: (task: TaskData) => void;
  onStatusChange: (task: TaskData, newStatus: TaskStatus) => void;
}

export default function TaskList({
  tasks,
  projects,
  loading,
  onDetail,
  onEdit,
  onDelete,
  onAddNote,
  onStatusChange,
}: Readonly<Props>) {
  const projectNameById = new Map(projects.map((project) => [project.id ?? "", project.name]));

  return (
    <DataTable value={tasks} dataKey="id" paginator rows={10} loading={loading} emptyMessage="Nessun task trovato">
      <Column field="title" header="Titolo" sortable />
      <Column field="type" header="Tipo" body={(row: TaskData) => row.type} sortable />
      <Column
        header="Riferimento"
        body={(row: TaskData) => taskLinkedEntityLabel(row, projectNameById.get(row.linkedEntity?.projectId ?? ""))}
      />
      <Column
        field="status"
        header="Stato"
        body={(row: TaskData) => <Tag value={taskStatusLabel(row.status)} severity={taskStatusSeverity(row.status)} />}
        sortable
      />
      <Column
        field="priority"
        header="Priorita"
        body={(row: TaskData) => <Tag value={taskPriorityLabel(row.priority)} severity={taskPrioritySeverity(row.priority)} />}
        sortable
      />
      <Column header="Assegnatari" body={(row: TaskData) => assigneeLabel(row.assignees)} />
      <Column field="createdAt" header="Creato il" body={(row: TaskData) => asDateString(row.createdAt)} sortable />
      <Column field="updatedAt" header="Aggiornato" body={(row: TaskData) => asDateString(row.updatedAt)} sortable />
      <Column header="Cambio stato" body={(row: TaskData) => <TaskStatusActions task={row} onChangeStatus={onStatusChange} />} />
      <Column
        header="Azioni"
        body={(row: TaskData) => (
          <div style={{display: "flex", gap: 4}}>
            <Button icon="pi pi-eye" className="p-button-text" onClick={() => onDetail(row)} />
            <Button icon="pi pi-pencil" className="p-button-text" onClick={() => onEdit(row)} />
            <Button icon="pi pi-comment" className="p-button-text" onClick={() => onAddNote(row)} />
            <Button icon="pi pi-trash" className="p-button-text p-button-danger" onClick={() => onDelete(row)} />
          </div>
        )}
      />
    </DataTable>
  );
}
