import {onCall, HttpsError} from "firebase-functions/v2/https";
import {FieldValue, getFirestore} from "firebase-admin/firestore";
import {
  REGION,
  asArray,
  asString,
  ensureAdmin,
  ensureAuthenticated,
  ensureLinkedEntity,
  ensureTaskPriority,
  ensureTaskType,
  getActorContext,
  normalizeAssignees,
  toTaskHistoryEntry,
} from "./helpers";

export const updateTask = onCall({region: REGION}, async (req) => {
  const uid = ensureAuthenticated(req.auth);
  const actor = await getActorContext(uid);
  ensureAdmin(actor);

  const data = (req.data ?? {}) as Record<string, unknown>;
  const taskId = asString(data.taskId);
  if (!taskId) {
    throw new HttpsError("invalid-argument", "taskId is required");
  }

  const db = getFirestore();
  const taskRef = db.collection("tasks").doc(taskId);
  const taskSnap = await taskRef.get();
  if (!taskSnap.exists) {
    throw new HttpsError("not-found", "Task not found");
  }

  const current = taskSnap.data() ?? {};
  const currentAssigneeUids = asArray<string>(current.assigneeUids);
  const currentPriority = asString(current.priority) ?? "medium";
  const currentLinkedEntity = current.linkedEntity as Record<string, unknown> | undefined;

  const nextType = ensureTaskType(data.type ?? current.type ?? "generic");
  const nextLinkedEntity = ensureLinkedEntity(nextType, data.linkedEntity ?? current.linkedEntity);
  const nextPriority = ensureTaskPriority(data.priority ?? current.priority ?? "medium");

  const {assignees, assigneeUids} = normalizeAssignees(data.assignees ?? current.assignees ?? []);

  const updatePayload: Record<string, unknown> = {
    title: asString(data.title) ?? asString(current.title) ?? "",
    description: asString(data.description) ?? asString(current.description) ?? null,
    type: nextType,
    linkedEntity: nextLinkedEntity,
    priority: nextPriority,
    assignees,
    assigneeUids,
    notes: asString(data.notes) ?? asString(current.notes) ?? null,
    updatedAt: FieldValue.serverTimestamp(),
  };

  const history = asArray<ReturnType<typeof toTaskHistoryEntry>>(current.history);

  if (currentPriority !== nextPriority) {
    history.push(
      toTaskHistoryEntry("priority_changed", actor, {
        fromPriority: currentPriority as "low" | "medium" | "high" | "urgent",
        toPriority: nextPriority,
      })
    );
  }

  const prevLinkedKey = JSON.stringify(currentLinkedEntity ?? {});
  const nextLinkedKey = JSON.stringify(nextLinkedEntity ?? {});
  if (prevLinkedKey !== nextLinkedKey) {
    history.push(toTaskHistoryEntry("linked_entity_changed", actor));
  }

  const currentSet = new Set(currentAssigneeUids);
  const nextSet = new Set(assigneeUids);
  const assigned = assigneeUids.filter((id) => !currentSet.has(id));
  const unassigned = currentAssigneeUids.filter((id) => !nextSet.has(id));

  if (assigned.length > 0) {
    history.push(toTaskHistoryEntry("assigned", actor, {note: assigned.join(", ")}));
  }
  if (unassigned.length > 0) {
    history.push(toTaskHistoryEntry("unassigned", actor, {note: unassigned.join(", ")}));
  }

  if (history.length > 0) {
    updatePayload.history = history;
  }

  await taskRef.update(updatePayload);

  return {success: true};
});
