import {onCall, HttpsError} from "firebase-functions/v2/https";
import {FieldValue, getFirestore} from "firebase-admin/firestore";
import {
  REGION,
  asArray,
  asString,
  ensureAuthenticated,
  getActorContext,
  isAssignedTo,
  toTaskHistoryEntry,
} from "./helpers";

export const addTaskNote = onCall({region: REGION}, async (req) => {
  const uid = ensureAuthenticated(req.auth);
  const actor = await getActorContext(uid);

  const data = (req.data ?? {}) as Record<string, unknown>;
  const taskId = asString(data.taskId);
  const note = asString(data.note);
  if (!taskId || !note) {
    throw new HttpsError("invalid-argument", "taskId and note are required");
  }

  const db = getFirestore();
  const taskRef = db.collection("tasks").doc(taskId);
  const taskSnap = await taskRef.get();
  if (!taskSnap.exists) {
    throw new HttpsError("not-found", "Task not found");
  }

  const task = taskSnap.data() ?? {};
  const canManageAll = actor.role === "admin";
  const assigned = isAssignedTo(actor.uid, task.assigneeUids);
  if (!canManageAll && !assigned) {
    throw new HttpsError("permission-denied", "You can only add notes to assigned tasks");
  }

  const history = asArray<ReturnType<typeof toTaskHistoryEntry>>(task.history);
  history.push(toTaskHistoryEntry("note_added", actor, {note}));

  await taskRef.update({
    notes: asString(task.notes) ? `${String(task.notes)}\n${note}` : note,
    history,
    updatedAt: FieldValue.serverTimestamp(),
  });

  return {success: true};
});
