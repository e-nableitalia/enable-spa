import {Button} from "primereact/button";
import type {TaskData, TaskStatus} from "../../../shared/types/taskData";

interface Props {
  task: TaskData;
  onChangeStatus: (task: TaskData, newStatus: TaskStatus) => void;
}

export default function TaskStatusActions({task, onChangeStatus}: Readonly<Props>) {
  const actions: Array<{label: string; value: TaskStatus; disabled: boolean}> = [
    {label: "To do", value: "todo", disabled: task.status === "todo"},
    {label: "In progress", value: "in_progress", disabled: task.status === "in_progress"},
    {label: "Done", value: "done", disabled: task.status === "done"},
  ];

  return (
    <div style={{display: "flex", gap: 6, flexWrap: "wrap"}}>
      {actions.map((action) => (
        <Button
          key={action.value}
          label={action.label}
          className="p-button-text p-button-sm"
          disabled={action.disabled}
          onClick={() => onChangeStatus(task, action.value)}
        />
      ))}
    </div>
  );
}
