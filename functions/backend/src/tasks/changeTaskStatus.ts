import {onCall, HttpsError} from "firebase-functions/v2/https";
import {getFirestore} from "firebase-admin/firestore";
import {sendTaskStatusChangedToAdmins} from "../utils/email";
import {
  REGION,
  asArray,
  asString,
  ensureAuthenticated,
  ensureTaskStatus,
  getActorContext,
  isAssignedTo,
  isValidStatusTransition,
  toTaskHistoryEntry,
  withUpdatedAndCompleted,
} from "./helpers";

function isActorAssigned(uid: string, task: Record<string, unknown>): boolean {
  if (isAssignedTo(uid, task.assigneeUids)) {
    return true;
  }

  const assignees = asArray<Record<string, unknown>>(task.assignees);
  return assignees.some((item) => item.type === "volunteer" && asString(item.volunteerUid) === uid);
}

export const changeTaskStatus = onCall({region: REGION}, async (req) => {
  const uid = ensureAuthenticated(req.auth);
  const actor = await getActorContext(uid);

  const data = (req.data ?? {}) as Record<string, unknown>;
  const taskId = asString(data.taskId);
  if (!taskId) {
    throw new HttpsError("invalid-argument", "taskId is required");
  }

  const newStatus = ensureTaskStatus(data.newStatus);
  const note = asString(data.note);

  const db = getFirestore();
  const taskRef = db.collection("tasks").doc(taskId);
  const taskSnap = await taskRef.get();
  if (!taskSnap.exists) {
    throw new HttpsError("not-found", "Task not found");
  }

  const task = taskSnap.data() ?? {};
  const currentStatus = ensureTaskStatus(task.status ?? "todo");

  const canManageAll = actor.role === "admin";
  const assigned = isActorAssigned(actor.uid, task);
  if (!canManageAll && !assigned) {
    throw new HttpsError("permission-denied", "You can only update assigned tasks");
  }

  if (!isValidStatusTransition(currentStatus, newStatus)) {
    throw new HttpsError("failed-precondition", `Invalid status transition: ${currentStatus} -> ${newStatus}`);
  }

  const history = asArray<ReturnType<typeof toTaskHistoryEntry>>(task.history);
  history.push(
    toTaskHistoryEntry("status_changed", actor, {
      fromStatus: currentStatus,
      toStatus: newStatus,
      note,
    })
  );

  const updatePayload: Record<string, unknown> = {
    status: newStatus,
    ...withUpdatedAndCompleted(newStatus),
    history,
  };

  await taskRef.update(updatePayload);

  await sendTaskStatusChangedToAdmins({
    taskId,
    title: asString(task.title) ?? "Task",
    fromStatus: currentStatus,
    toStatus: newStatus,
    changedBy: actor.displayName,
    note,
  });

  return {success: true};
});
