import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { getInvokeId } from "../utils/invoke";
import { requireAdmin, getProjectOrThrow, assertProjectContentWritable } from "./projectAccess";

const REGION = "europe-west1";

/**
 * Aggiorna metadati checklist progetto:
 * - `label` nel mirror `projects/{id}.checklists`
 * - `title` nel documento `checklists/{checklistId}`
 */
export const updateProjectChecklistMetadata = onCall({ region: REGION }, async (request) => {
  const invokeId = getInvokeId(request);
  console.log(`[updateProjectChecklistMetadata] Invoke ID: ${invokeId} - Function called`);

  const uid = request.auth?.uid;
  if (!uid) {
    throw new HttpsError("unauthenticated", "Authentication required");
  }

  const { projectId, checklistId, label, title } = (request.data ?? {}) as {
    projectId?: string;
    checklistId?: string;
    label?: string;
    title?: string;
  };

  if (!projectId || typeof projectId !== "string") {
    throw new HttpsError("invalid-argument", "Missing or invalid projectId");
  }
  if (!checklistId || typeof checklistId !== "string") {
    throw new HttpsError("invalid-argument", "Missing or invalid checklistId");
  }
  if (!label || typeof label !== "string" || !label.trim()) {
    throw new HttpsError("invalid-argument", "Missing or invalid label");
  }
  if (!title || typeof title !== "string" || !title.trim()) {
    throw new HttpsError("invalid-argument", "Missing or invalid title");
  }

  const db = getFirestore();
  await requireAdmin(db, uid);
  const project = await getProjectOrThrow(db, projectId);
  assertProjectContentWritable(project.status);

  if (!project.checklists.some((c) => c.checklistId === checklistId)) {
    throw new HttpsError("not-found", "Checklist not linked to this project");
  }

  const checklistRef = db.collection("checklists").doc(checklistId);
  const checklistSnap = await checklistRef.get();
  if (!checklistSnap.exists) {
    throw new HttpsError("not-found", "Checklist not found");
  }

  const nextChecklists = project.checklists.map((c) =>
    c.checklistId === checklistId ? { ...c, label: label.trim() } : c
  );

  const batch = db.batch();
  batch.update(db.collection("projects").doc(projectId), {
    checklists: nextChecklists,
    updatedAt: FieldValue.serverTimestamp(),
  });
  batch.update(checklistRef, {
    title: title.trim(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  await batch.commit();

  console.log(
    `[updateProjectChecklistMetadata] OK: checklist ${checklistId} metadata updated in project ${projectId}`
  );
  return { checklistId, label: label.trim(), title: title.trim() };
});
