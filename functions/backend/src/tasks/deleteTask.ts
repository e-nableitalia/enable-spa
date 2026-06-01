import {onCall, HttpsError} from "firebase-functions/v2/https";
import {FieldValue, getFirestore} from "firebase-admin/firestore";
import {
  REGION,
  asString,
  ensureAdmin,
  ensureAuthenticated,
  getActorContext,
} from "./helpers";

export const deleteTask = onCall({region: REGION}, async (req) => {
  const uid = ensureAuthenticated(req.auth);
  const actor = await getActorContext(uid);
  ensureAdmin(actor);

  const taskId = asString((req.data as {taskId?: unknown} | undefined)?.taskId);
  if (!taskId) {
    throw new HttpsError("invalid-argument", "taskId is required");
  }

  const db = getFirestore();
  const taskRef = db.collection("tasks").doc(taskId);
  const snap = await taskRef.get();
  if (!snap.exists) {
    throw new HttpsError("not-found", "Task not found");
  }

  await taskRef.update({
    deleted: true,
    deletedAt: FieldValue.serverTimestamp(),
    deletedByUid: actor.uid,
    updatedAt: FieldValue.serverTimestamp(),
  });

  return {success: true};
});
