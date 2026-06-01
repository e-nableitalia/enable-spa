import {onCall, HttpsError} from "firebase-functions/v2/https";
import {FieldValue, getFirestore} from "firebase-admin/firestore";
import {
  REGION,
  ensureAdmin,
  ensureAuthenticated,
  ensureLinkedEntity,
  ensureTaskPriority,
  ensureTaskStatus,
  ensureTaskType,
  getActorContext,
  normalizeAssignees,
  toTaskHistoryEntry,
  asString,
} from "./helpers";

export const createTask = onCall({region: REGION}, async (req) => {
  const uid = ensureAuthenticated(req.auth);
  const actor = await getActorContext(uid);
  ensureAdmin(actor);

  const data = (req.data ?? {}) as Record<string, unknown>;
  const title = asString(data.title);
  if (!title) {
    throw new HttpsError("invalid-argument", "title is required");
  }

  const type = ensureTaskType(data.type ?? "generic");
  const status = ensureTaskStatus(data.status ?? "todo");
  const priority = ensureTaskPriority(data.priority ?? "medium");
  const linkedEntity = ensureLinkedEntity(type, data.linkedEntity);
  const description = asString(data.description);
  const notes = asString(data.notes);
  const {assignees, assigneeUids} = normalizeAssignees(data.assignees);

  const history = [toTaskHistoryEntry("created", actor, {note: "Task created"})];

  const payload = {
    title,
    description: description ?? null,
    type,
    linkedEntity,
    status,
    priority,
    assignees,
    assigneeUids,
    notes: notes ?? null,
    createdByUid: actor.uid,
    createdByDisplayName: actor.displayName,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    completedAt: status === "done" ? FieldValue.serverTimestamp() : null,
    history,
    deleted: false,
  };

  const db = getFirestore();
  const taskRef = await db.collection("tasks").add(payload);

  return {success: true, id: taskRef.id};
});
