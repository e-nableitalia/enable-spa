export type TaskStatus = "waiting_volunteer" | "todo" | "in_progress" | "done";

export type TaskPriority = "low" | "medium" | "high" | "urgent";

export type TaskType = "generic" | "deviceRequest" | "project";

export type TaskAssigneeType = "volunteer" | "group";

export type TaskHistoryEventType =
  | "created"
  | "updated"
  | "status_changed"
  | "assigned"
  | "unassigned"
  | "note_added"
  | "priority_changed"
  | "linked_entity_changed";

export interface TaskLinkedEntity {
  type: TaskType;
  deviceRequestId?: string;
  projectId?: string;
}

export interface TaskAssignee {
  type: TaskAssigneeType;
  volunteerUid?: string;
  groupId?: string;
  displayName?: string;
}

export interface TaskHistoryEntry {
  id?: string;
  eventType: TaskHistoryEventType;
  fromStatus?: TaskStatus;
  toStatus?: TaskStatus;
  fromPriority?: TaskPriority;
  toPriority?: TaskPriority;
  note?: string;
  authorUid: string;
  authorDisplayName?: string;
  createdAt: any;
}

export interface TaskData {
  id?: string;
  title: string;
  description?: string;
  type: TaskType;
  linkedEntity?: TaskLinkedEntity;
  status: TaskStatus;
  priority: TaskPriority;
  assignees: TaskAssignee[];
  assigneeUids: string[];
  notes?: string;
  createdByUid: string;
  createdByDisplayName?: string;
  createdAt: any;
  updatedAt?: any;
  completedAt?: any;
  history?: TaskHistoryEntry[];
}
