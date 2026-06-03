import {useEffect, useState} from "react";
import {Dialog} from "primereact/dialog";
import {Button} from "primereact/button";
import {InputText} from "primereact/inputtext";
import {InputTextarea} from "primereact/inputtextarea";
import {Dropdown} from "primereact/dropdown";
import {MultiSelect} from "primereact/multiselect";
import {Checkbox} from "primereact/checkbox";
import type {TaskAssignee, TaskData, TaskPriority, TaskStatus, TaskType} from "../../../shared/types/taskData";

interface VolunteerOption {
  uid: string;
  displayName: string;
  email?: string | null;
}

interface ProjectOption {
  id: string;
  name: string;
}

interface TaskDraft {
  title: string;
  description: string;
  status: TaskStatus;
  type: TaskType;
  linkedDeviceRequestId: string;
  linkedProjectId: string;
  priority: TaskPriority;
  assignees: TaskAssignee[];
  notes: string;
  notifyTelegramWaitingVolunteer: boolean;
}

interface Props {
  visible: boolean;
  task: TaskData | null;
  volunteers: VolunteerOption[];
  projects: ProjectOption[];
  onHide: () => void;
  onSave: (payload: TaskDraft) => void;
  saving?: boolean;
}

const TYPE_OPTIONS = [
  {label: "Generic", value: "generic"},
  {label: "Device Request", value: "deviceRequest"},
  {label: "Project", value: "project"},
];

const PRIORITY_OPTIONS = [
  {label: "Low", value: "low"},
  {label: "Medium", value: "medium"},
  {label: "High", value: "high"},
  {label: "Urgent", value: "urgent"},
];

const STATUS_OPTIONS = [
  {label: "Waiting volunteer", value: "waiting_volunteer"},
  {label: "To do", value: "todo"},
  {label: "In progress", value: "in_progress"},
  {label: "Done", value: "done"},
];

export default function TaskEditDialog({
  visible,
  task,
  volunteers,
  projects,
  onHide,
  onSave,
  saving,
}: Readonly<Props>) {
  const [draft, setDraft] = useState<TaskDraft>({
    title: "",
    description: "",
    status: "todo",
    type: "generic",
    linkedDeviceRequestId: "",
    linkedProjectId: "",
    priority: "medium",
    assignees: [],
    notes: "",
    notifyTelegramWaitingVolunteer: false,
  });

  useEffect(() => {
    if (!task) {
      setDraft({
        title: "",
        description: "",
        status: "todo",
        type: "generic",
        linkedDeviceRequestId: "",
        linkedProjectId: "",
        priority: "medium",
        assignees: [],
        notes: "",
        notifyTelegramWaitingVolunteer: false,
      });
      return;
    }

    setDraft({
      title: task.title,
      description: task.description || "",
      status: task.status,
      type: task.type,
      linkedDeviceRequestId: task.linkedEntity?.deviceRequestId || "",
      linkedProjectId: task.linkedEntity?.projectId || "",
      priority: task.priority,
      assignees: task.assignees,
      notes: task.notes || "",
      notifyTelegramWaitingVolunteer: false,
    });
  }, [task, visible]);

  const volunteerChoices = volunteers.map((item) => ({
    label: item.email ? `${item.displayName} (${item.email})` : item.displayName,
    value: {
      type: "volunteer",
      volunteerUid: item.uid,
      displayName: item.displayName,
    } as TaskAssignee,
  }));

  return (
    <Dialog
      header={task ? "Modifica task" : "Nuovo task"}
      visible={visible}
      onHide={onHide}
      style={{width: "90vw", maxWidth: 820}}
      modal
      footer={
        <div style={{display: "flex", justifyContent: "flex-end", gap: 8}}>
          <Button label="Annulla" className="p-button-text" onClick={onHide} />
          <Button
            label="Salva"
            onClick={() => onSave(draft)}
            loading={saving}
            disabled={!draft.title.trim()}
          />
        </div>
      }
    >
      <div style={{display: "grid", gap: 10}}>
        <div>
          <label htmlFor="task-title">Titolo</label>
          <InputText id="task-title" value={draft.title} onChange={(e) => setDraft({...draft, title: e.target.value})} style={{width: "100%"}} />
        </div>
        <div>
          <label htmlFor="task-description">Descrizione</label>
          <InputTextarea
            id="task-description"
            value={draft.description}
            onChange={(e) => setDraft({...draft, description: e.target.value})}
            rows={3}
            autoResize
            style={{width: "100%"}}
          />
        </div>
        <div style={{display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 10}}>
          <div>
            <label htmlFor="task-status">Stato</label>
            <Dropdown
              inputId="task-status"
              value={draft.status}
              options={STATUS_OPTIONS}
              optionLabel="label"
              optionValue="value"
              onChange={(e) => setDraft({...draft, status: e.value as TaskStatus})}
              style={{width: "100%"}}
              disabled={Boolean(task)}
            />
          </div>
          <div>
            <label htmlFor="task-type">Tipo</label>
            <Dropdown
              inputId="task-type"
              value={draft.type}
              options={TYPE_OPTIONS}
              optionLabel="label"
              optionValue="value"
              onChange={(e) => setDraft({...draft, type: e.value as TaskType})}
              style={{width: "100%"}}
            />
          </div>
          <div>
            <label htmlFor="task-priority">Priorita</label>
            <Dropdown
              inputId="task-priority"
              value={draft.priority}
              options={PRIORITY_OPTIONS}
              optionLabel="label"
              optionValue="value"
              onChange={(e) => setDraft({...draft, priority: e.value as TaskPriority})}
              style={{width: "100%"}}
            />
          </div>
        </div>

        {draft.type === "deviceRequest" ? (
          <div>
            <label htmlFor="task-device-request-id">Device Request ID</label>
            <InputText
              id="task-device-request-id"
              value={draft.linkedDeviceRequestId}
              onChange={(e) => setDraft({...draft, linkedDeviceRequestId: e.target.value})}
              style={{width: "100%"}}
            />
          </div>
        ) : null}

        {draft.type === "project" ? (
          <div>
            <label htmlFor="task-project-id">Progetto</label>
            <Dropdown
              inputId="task-project-id"
              value={draft.linkedProjectId}
              options={projects.map((project) => ({label: project.name, value: project.id}))}
              optionLabel="label"
              optionValue="value"
              onChange={(e) => setDraft({...draft, linkedProjectId: (e.value as string) ?? ""})}
              style={{width: "100%"}}
            />
          </div>
        ) : null}

        <div>
          <label htmlFor="task-assignees">Assegnatari</label>
          <MultiSelect
            inputId="task-assignees"
            value={draft.assignees}
            options={volunteerChoices}
            optionLabel="label"
            optionValue="value"
            onChange={(e) => setDraft({...draft, assignees: (e.value as TaskAssignee[]) ?? []})}
            display="chip"
            style={{width: "100%"}}
          />
        </div>

        <div>
          <label htmlFor="task-notes">Note</label>
          <InputTextarea
            id="task-notes"
            value={draft.notes}
            onChange={(e) => setDraft({...draft, notes: e.target.value})}
            rows={3}
            autoResize
            style={{width: "100%"}}
          />
        </div>

        {!task ? (
          <div style={{display: "flex", alignItems: "center", gap: 8}}>
            <Checkbox
              inputId="task-notify-telegram"
              checked={draft.notifyTelegramWaitingVolunteer}
              disabled={draft.status !== "waiting_volunteer"}
              onChange={(e) => setDraft({...draft, notifyTelegramWaitingVolunteer: Boolean(e.checked)})}
            />
            <label htmlFor="task-notify-telegram">
              Notifica Telegram nuovo task in attesa volontario
            </label>
          </div>
        ) : null}
      </div>
    </Dialog>
  );
}
