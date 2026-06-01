import type {TaskAssignee, TaskData, TaskPriority, TaskStatus, TaskType} from "../../../shared/types/taskData";

export function taskStatusLabel(status: TaskStatus): string {
  const map: Record<TaskStatus, string> = {
    todo: "To do",
    in_progress: "In progress",
    done: "Done",
  };
  return map[status];
}

export function taskStatusSeverity(status: TaskStatus): "secondary" | "info" | "success" {
  const map: Record<TaskStatus, "secondary" | "info" | "success"> = {
    todo: "secondary",
    in_progress: "info",
    done: "success",
  };
  return map[status];
}

export function taskPriorityLabel(priority: TaskPriority): string {
  const map: Record<TaskPriority, string> = {
    low: "Low",
    medium: "Medium",
    high: "High",
    urgent: "Urgent",
  };
  return map[priority];
}

export function taskPrioritySeverity(priority: TaskPriority): "secondary" | "info" | "warning" | "danger" {
  const map: Record<TaskPriority, "secondary" | "info" | "warning" | "danger"> = {
    low: "secondary",
    medium: "info",
    high: "warning",
    urgent: "danger",
  };
  return map[priority];
}

export function isTaskAssignedTo(task: Pick<TaskData, "assigneeUids">, uid: string): boolean {
  return task.assigneeUids.includes(uid);
}

export function assigneeLabel(assignees: TaskAssignee[]): string {
  if (assignees.length === 0) {
    return "-";
  }
  return assignees
    .map((item) => item.displayName || item.volunteerUid || item.groupId || "-")
    .join(", ");
}

export function taskLinkedEntityLabel(task: Pick<TaskData, "type" | "linkedEntity">, projectName?: string): string {
  if (task.type === "generic") {
    return "Generico";
  }

  if (task.type === "deviceRequest") {
    return `Richiesta device: ${task.linkedEntity?.deviceRequestId ?? "-"}`;
  }

  return `Progetto: ${projectName ?? task.linkedEntity?.projectId ?? "-"}`;
}

export function isValidLinkedEntity(type: TaskType, linkedEntity: TaskData["linkedEntity"] | undefined): boolean {
  if (type === "generic") {
    return !linkedEntity?.deviceRequestId && !linkedEntity?.projectId;
  }

  if (type === "deviceRequest") {
    return Boolean(linkedEntity?.deviceRequestId);
  }

  return Boolean(linkedEntity?.projectId);
}

export function asDateString(value: unknown): string {
  if (!value) {
    return "-";
  }
  if (value instanceof Date) {
    return value.toLocaleString();
  }
  if (typeof value === "object" && value !== null && "toDate" in value) {
    const toDate = (value as {toDate?: () => Date}).toDate;
    if (typeof toDate === "function") {
      return toDate().toLocaleString();
    }
  }
  return "-";
}
