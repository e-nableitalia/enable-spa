import {onCall, HttpsError} from "firebase-functions/v2/https";
import {FieldValue, getFirestore} from "firebase-admin/firestore";
import {
  REGION,
  asString,
  ensureAdmin,
  ensureAuthenticated,
  getActorContext,
} from "./helpers";

export const deleteProject = onCall({region: REGION}, async (req) => {
  const uid = ensureAuthenticated(req.auth);
  const actor = await getActorContext(uid);
  ensureAdmin(actor);

  const projectId = asString((req.data ?? {}).projectId);
  if (!projectId) {
    throw new HttpsError("invalid-argument", "projectId is required");
  }

  const db = getFirestore();
  const projectRef = db.collection("projects").doc(projectId);
  const projectSnap = await projectRef.get();
  if (!projectSnap.exists) {
    throw new HttpsError("not-found", "Project not found");
  }

  const linkedTasksSnap = await db.collection("tasks").where("linkedEntity.projectId", "==", projectId).get();
  const hasActiveLinkedTasks = linkedTasksSnap.docs.some((docSnap) => docSnap.data()?.deleted !== true);

  if (hasActiveLinkedTasks) {
    await projectRef.update({
      status: "archived",
      updatedAt: FieldValue.serverTimestamp(),
      archivedAt: FieldValue.serverTimestamp(),
      archivedByUid: actor.uid,
    });
    return {success: true, archived: true};
  }

  await projectRef.update({
    status: "archived",
    updatedAt: FieldValue.serverTimestamp(),
    archivedAt: FieldValue.serverTimestamp(),
    archivedByUid: actor.uid,
  });

  return {success: true, archived: true};
});
