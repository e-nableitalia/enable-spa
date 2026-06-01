import {Panel} from "primereact/panel";
import {InputText} from "primereact/inputtext";
import {Dropdown} from "primereact/dropdown";
import {Calendar} from "primereact/calendar";
import {Button} from "primereact/button";
import type {TaskPriority, TaskStatus, TaskType} from "../../../shared/types/taskData";

export interface TaskFilterState {
  searchText: string;
  status: TaskStatus | "";
  priority: TaskPriority | "";
  type: TaskType | "";
  assigneeUid: string;
  deviceRequestId: string;
  projectId: string;
  createdFrom: Date | null;
  createdTo: Date | null;
}

interface Option {
  label: string;
  value: string;
}

interface Props {
  filters: TaskFilterState;
  projectOptions: Option[];
  volunteerOptions: Option[];
  onChange: (next: TaskFilterState) => void;
  onReset: () => void;
}

const STATUS_OPTIONS: Option[] = [
  {label: "To do", value: "todo"},
  {label: "In progress", value: "in_progress"},
  {label: "Done", value: "done"},
];

const PRIORITY_OPTIONS: Option[] = [
  {label: "Low", value: "low"},
  {label: "Medium", value: "medium"},
  {label: "High", value: "high"},
  {label: "Urgent", value: "urgent"},
];

const TYPE_OPTIONS: Option[] = [
  {label: "Generic", value: "generic"},
  {label: "Device Request", value: "deviceRequest"},
  {label: "Project", value: "project"},
];

function patch<K extends keyof TaskFilterState>(
  filters: TaskFilterState,
  key: K,
  value: TaskFilterState[K]
): TaskFilterState {
  return {...filters, [key]: value};
}

export default function TaskFilters({
  filters,
  projectOptions,
  volunteerOptions,
  onChange,
  onReset,
}: Readonly<Props>) {
  return (
    <Panel header="Filtri task" toggleable>
      <div style={{display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 12}}>
        <div>
          <label>Ricerca</label>
          <InputText
            value={filters.searchText}
            onChange={(e) => onChange(patch(filters, "searchText", e.target.value))}
            placeholder="Titolo, descrizione, note"
            style={{width: "100%"}}
          />
        </div>
        <div>
          <label>Stato</label>
          <Dropdown
            value={filters.status}
            options={STATUS_OPTIONS}
            optionLabel="label"
            optionValue="value"
            onChange={(e) => onChange(patch(filters, "status", (e.value as TaskStatus | "") ?? ""))}
            showClear
            style={{width: "100%"}}
          />
        </div>
        <div>
          <label>Priorita</label>
          <Dropdown
            value={filters.priority}
            options={PRIORITY_OPTIONS}
            optionLabel="label"
            optionValue="value"
            onChange={(e) => onChange(patch(filters, "priority", (e.value as TaskPriority | "") ?? ""))}
            showClear
            style={{width: "100%"}}
          />
        </div>
        <div>
          <label>Tipo</label>
          <Dropdown
            value={filters.type}
            options={TYPE_OPTIONS}
            optionLabel="label"
            optionValue="value"
            onChange={(e) => onChange(patch(filters, "type", (e.value as TaskType | "") ?? ""))}
            showClear
            style={{width: "100%"}}
          />
        </div>
        <div>
          <label>Assegnatario</label>
          <Dropdown
            value={filters.assigneeUid}
            options={volunteerOptions}
            optionLabel="label"
            optionValue="value"
            onChange={(e) => onChange(patch(filters, "assigneeUid", (e.value as string) ?? ""))}
            showClear
            style={{width: "100%"}}
          />
        </div>
        <div>
          <label>Device request ID</label>
          <InputText
            value={filters.deviceRequestId}
            onChange={(e) => onChange(patch(filters, "deviceRequestId", e.target.value))}
            placeholder="req id"
            style={{width: "100%"}}
          />
        </div>
        <div>
          <label>Progetto</label>
          <Dropdown
            value={filters.projectId}
            options={projectOptions}
            optionLabel="label"
            optionValue="value"
            onChange={(e) => onChange(patch(filters, "projectId", (e.value as string) ?? ""))}
            showClear
            style={{width: "100%"}}
          />
        </div>
        <div>
          <label>Creato da</label>
          <Calendar
            value={filters.createdFrom}
            onChange={(e) => onChange(patch(filters, "createdFrom", (e.value as Date | null) ?? null))}
            showIcon
            dateFormat="dd/mm/yy"
            style={{width: "100%"}}
          />
        </div>
        <div>
          <label>Creato a</label>
          <Calendar
            value={filters.createdTo}
            onChange={(e) => onChange(patch(filters, "createdTo", (e.value as Date | null) ?? null))}
            showIcon
            dateFormat="dd/mm/yy"
            style={{width: "100%"}}
          />
        </div>
      </div>
      <div style={{display: "flex", justifyContent: "flex-end", marginTop: 12}}>
        <Button label="Reset" icon="pi pi-filter-slash" className="p-button-text" onClick={onReset} />
      </div>
    </Panel>
  );
}
