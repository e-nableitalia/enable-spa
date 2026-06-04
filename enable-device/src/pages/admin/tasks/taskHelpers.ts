import type {TaskAssignee, TaskData, TaskPriority, TaskStatus, TaskType} from "../../../shared/types/taskData";

export function taskStatusLabel(status: TaskStatus): string {
  const map: Record<TaskStatus, string> = {
    waiting_volunteer: "Waiting volunteer",
    todo: "To do",
    in_progress: "In progress",
    done: "Done",
  };
  return map[status];
}

export function taskStatusSeverity(status: TaskStatus): "secondary" | "info" | "success" | "warning" {
  const map: Record<TaskStatus, "secondary" | "info" | "success" | "warning"> = {
    waiting_volunteer: "warning",
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
  if (typeof value === "object" && value !== null) {
    const maybeTimestamp = value as {toDate?: () => Date; seconds?: number; _seconds?: number};
    if (typeof maybeTimestamp.toDate === "function") {
      try {
        const parsed = maybeTimestamp.toDate();
        if (parsed instanceof Date && !Number.isNaN(parsed.getTime())) {
          return parsed.toLocaleString();
        }
      } catch {
        // Ignore and fallback to seconds parsing.
      }
    }

    const seconds = typeof maybeTimestamp.seconds === "number" ? maybeTimestamp.seconds :
      typeof maybeTimestamp._seconds === "number" ? maybeTimestamp._seconds : null;
    if (seconds !== null) {
      const parsed = new Date(seconds * 1000);
      return Number.isNaN(parsed.getTime()) ? "-" : parsed.toLocaleString();
    }
  }
  return "-";
}
