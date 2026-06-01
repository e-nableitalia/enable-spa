import {Dialog} from "primereact/dialog";
import {Panel} from "primereact/panel";
import {Divider} from "primereact/divider";
import {Tag} from "primereact/tag";
import type {TaskData} from "../../../shared/types/taskData";
import {
  assigneeLabel,
  asDateString,
  taskPriorityLabel,
  taskPrioritySeverity,
  taskStatusLabel,
  taskStatusSeverity,
} from "./taskHelpers";

interface Props {
  task: TaskData | null;
  visible: boolean;
  linkedLabel?: string;
  onHide: () => void;
}

export default function TaskDetailDialog({task, visible, linkedLabel, onHide}: Readonly<Props>) {
  return (
    <Dialog header="Dettaglio task" visible={visible} onHide={onHide} style={{width: "90vw", maxWidth: 980}} modal>
      {!task ? (
        <div>Nessun task selezionato.</div>
      ) : (
        <div style={{display: "grid", gap: 10}}>
          <Panel header="Informazioni">
            <div><strong>Titolo:</strong> {task.title}</div>
            <div><strong>Descrizione:</strong> {task.description || "-"}</div>
            <div><strong>Tipo:</strong> {task.type}</div>
            <div><strong>Riferimento:</strong> {linkedLabel || "Generico"}</div>
            <div style={{display: "flex", gap: 8, marginTop: 6}}>
              <Tag value={taskStatusLabel(task.status)} severity={taskStatusSeverity(task.status)} />
              <Tag value={taskPriorityLabel(task.priority)} severity={taskPrioritySeverity(task.priority)} />
            </div>
            <div><strong>Assegnatari:</strong> {assigneeLabel(task.assignees)}</div>
            <div><strong>Note:</strong> {task.notes || "-"}</div>
          </Panel>

          <Panel header="Date">
            <div><strong>Creato:</strong> {asDateString(task.createdAt)}</div>
            <div><strong>Aggiornato:</strong> {asDateString(task.updatedAt)}</div>
            <div><strong>Completato:</strong> {asDateString(task.completedAt)}</div>
          </Panel>

          <Panel header="History">
            {(task.history ?? []).length === 0 ? (
              <div>Nessun evento.</div>
            ) : (
              <div>
                {(task.history ?? []).map((entry, index) => (
                  <div key={`${entry.id ?? "h"}-${index}`} style={{padding: "8px 0"}}>
                    <div>
                      <strong>{entry.eventType}</strong> - {asDateString(entry.createdAt)} - {entry.authorDisplayName || entry.authorUid}
                    </div>
                    {entry.fromStatus || entry.toStatus ? (
                      <div>Stato: {entry.fromStatus || "-"} {"->"} {entry.toStatus || "-"}</div>
                    ) : null}
                    {entry.fromPriority || entry.toPriority ? (
                      <div>Priorita: {entry.fromPriority || "-"} {"->"} {entry.toPriority || "-"}</div>
                    ) : null}
                    {entry.note ? <div>Nota: {entry.note}</div> : null}
                    <Divider style={{margin: "8px 0 0"}} />
                  </div>
                ))}
              </div>
            )}
          </Panel>
        </div>
      )}
    </Dialog>
  );
}
