import {FieldValue, getFirestore, Timestamp} from "firebase-admin/firestore";
import {HttpsError} from "firebase-functions/v2/https";

export type TaskStatus = "todo" | "in_progress" | "done";
export type TaskPriority = "low" | "medium" | "high" | "urgent";
export type TaskType = "generic" | "deviceRequest" | "project";
export type TaskHistoryEventType =
  | "created"
  | "updated"
  | "status_changed"
  | "assigned"
  | "unassigned"
  | "note_added"
  | "priority_changed"
  | "linked_entity_changed";

export interface TaskAssignee {
  type: "volunteer" | "group";
  volunteerUid?: string;
  groupId?: string;
  displayName?: string;
}

export interface TaskLinkedEntity {
  type: TaskType;
  deviceRequestId?: string;
  projectId?: string;
}

export interface TaskHistoryEntry {
  eventType: TaskHistoryEventType;
  fromStatus?: TaskStatus;
  toStatus?: TaskStatus;
  fromPriority?: TaskPriority;
  toPriority?: TaskPriority;
  note?: string;
  authorUid: string;
  authorDisplayName?: string;
  createdAt: unknown;
}

export interface ActorContext {
  uid: string;
  role: string;
  displayName: string;
}

const TASK_STATUS_VALUES: TaskStatus[] = ["todo", "in_progress", "done"];
const TASK_PRIORITY_VALUES: TaskPriority[] = ["low", "medium", "high", "urgent"];
const TASK_TYPE_VALUES: TaskType[] = ["generic", "deviceRequest", "project"];

export const REGION = "europe-west1";

export function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value.trim() : undefined;
}

export function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

export function ensureAuthenticated(auth: unknown): string {
  const uid = (auth as {uid?: string} | undefined)?.uid;
  if (!uid) {
    throw new HttpsError("unauthenticated", "Authentication required");
  }
  return uid;
}

export async function getActorContext(uid: string): Promise<ActorContext> {
  const db = getFirestore();
  const userSnap = await db.collection("users").doc(uid).get();
  if (!userSnap.exists) {
    throw new HttpsError("not-found", "User not found");
  }

  const role = String(userSnap.data()?.role ?? "");
  if (!role) {
    throw new HttpsError("failed-precondition", "User role missing");
  }

  const email = String(userSnap.data()?.email ?? "");
  const profileSnap = await db.collection("users").doc(uid).collection("private").doc("profile").get();
  const profile = profileSnap.exists ? profileSnap.data() ?? {} : {};
  const firstName = asString(profile.firstName) ?? "";
  const lastName = asString(profile.lastName) ?? "";
  const displayName = `${firstName} ${lastName}`.trim() || email || uid;

  return {uid, role, displayName};
}

export function ensureAdmin(actor: ActorContext): void {
  if (actor.role !== "admin") {
    throw new HttpsError("permission-denied", "Only admins can perform this action");
  }
}

export function ensureTaskStatus(value: unknown): TaskStatus {
  if (typeof value !== "string" || !TASK_STATUS_VALUES.includes(value as TaskStatus)) {
    throw new HttpsError("invalid-argument", "Invalid task status");
  }
  return value as TaskStatus;
}

export function ensureTaskPriority(value: unknown): TaskPriority {
  if (typeof value !== "string" || !TASK_PRIORITY_VALUES.includes(value as TaskPriority)) {
    throw new HttpsError("invalid-argument", "Invalid task priority");
  }
  return value as TaskPriority;
}

export function ensureTaskType(value: unknown): TaskType {
  if (typeof value !== "string" || !TASK_TYPE_VALUES.includes(value as TaskType)) {
    throw new HttpsError("invalid-argument", "Invalid task type");
  }
  return value as TaskType;
}

export function normalizeAssignees(raw: unknown): {assignees: TaskAssignee[]; assigneeUids: string[]} {
  const list = asArray<Record<string, unknown>>(raw)
    .map((item) => {
      const type = item.type === "group" ? "group" : "volunteer";
      const volunteerUid = asString(item.volunteerUid);
      const groupId = asString(item.groupId);
      const displayName = asString(item.displayName);
      return {
        type,
        volunteerUid,
        groupId,
        displayName,
      } as TaskAssignee;
    })
    .filter((item) => (item.type === "volunteer" ? Boolean(item.volunteerUid) : Boolean(item.groupId)));

  const assigneeUids = Array.from(
    new Set(
      list
        .filter((item) => item.type === "volunteer" && typeof item.volunteerUid === "string")
        .map((item) => item.volunteerUid as string)
    )
  );

  return {assignees: list, assigneeUids};
}

export function ensureLinkedEntity(type: TaskType, raw: unknown): TaskLinkedEntity | undefined {
  if (type === "generic") {
    return {type: "generic"};
  }

  const entity = (raw ?? {}) as Record<string, unknown>;
  if (type === "deviceRequest") {
    const deviceRequestId = asString(entity.deviceRequestId);
    if (!deviceRequestId) {
      throw new HttpsError("invalid-argument", "deviceRequestId is required for deviceRequest tasks");
    }
    return {type, deviceRequestId};
  }

  const projectId = asString(entity.projectId);
  if (!projectId) {
    throw new HttpsError("invalid-argument", "projectId is required for project tasks");
  }
  return {type, projectId};
}

export function toTaskHistoryEntry(
  eventType: TaskHistoryEventType,
  author: ActorContext,
  overrides: Omit<Partial<TaskHistoryEntry>, "eventType" | "authorUid" | "authorDisplayName" | "createdAt"> = {}
): TaskHistoryEntry {
  return {
    eventType,
    authorUid: author.uid,
    authorDisplayName: author.displayName,
    createdAt: Timestamp.now(),
    ...overrides,
  };
}

export function isAssignedTo(uid: string, assigneeUids: unknown): boolean {
  const list = asArray<string>(assigneeUids);
  return list.includes(uid);
}

export function isValidStatusTransition(fromStatus: TaskStatus, toStatus: TaskStatus): boolean {
  const transitions: Record<TaskStatus, TaskStatus[]> = {
    todo: ["in_progress"],
    in_progress: ["todo", "done"],
    done: ["in_progress"],
  };

  return transitions[fromStatus].includes(toStatus);
}

export function withUpdatedAndCompleted(newStatus: TaskStatus): {updatedAt: unknown; completedAt: unknown} {
  return {
    updatedAt: FieldValue.serverTimestamp(),
    completedAt: newStatus === "done" ? FieldValue.serverTimestamp() : null,
  };
}

export function timestampFromInput(value: unknown): Date | null {
  if (!value) {
    return null;
  }
  if (value instanceof Date) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  if (typeof value === "object" && value !== null && "toDate" in value) {
    const toDate = (value as {toDate?: () => Date}).toDate;
    if (typeof toDate === "function") {
      return toDate();
    }
  }
  return null;
}
