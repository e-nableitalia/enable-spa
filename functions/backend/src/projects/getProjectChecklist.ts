import { onCall, HttpsError } from "firebase-functions/v2/https";
import type { CallableRequest } from "firebase-functions/v2/https";
import { getFirestore } from "firebase-admin/firestore";
import { getInvokeId } from "../utils/invoke";
import { getChecklist } from "../organizer/getChecklist";
import { requireStaffRole, getProjectOrThrow, assertChecklistBelongsToProject } from "./projectAccess";

const REGION = "europe-west1";

/**
 * Cloud Function callable del dominio "projects": legge la checklist
 * collegata a un progetto. Lettura, staff-only, sempre permessa
 * indipendentemente dallo stato del progetto (anche `archived`/`closed`).
 */
export const getProjectChecklist = onCall({ region: REGION }, async (request) => {
  const invokeId = getInvokeId(request);
  console.log(`[getProjectChecklist] Invoke ID: ${invokeId} - Function called`);

  const uid = request.auth?.uid;
  if (!uid) {
    throw new HttpsError("unauthenticated", "User must be authenticated");
  }

  const { projectId, checklistId } = (request.data ?? {}) as { projectId?: string; checklistId?: string };
  if (!projectId || typeof projectId !== "string") {
    throw new HttpsError("invalid-argument", "Missing parameter: projectId");
  }
  if (!checklistId || typeof checklistId !== "string") {
    throw new HttpsError("invalid-argument", "Missing parameter: checklistId");
  }

  const db = getFirestore();
  await requireStaffRole(db, uid);
  const project = await getProjectOrThrow(db, projectId);
  assertChecklistBelongsToProject(project, checklistId);

  const result = (await getChecklist.run({
    ...request,
    data: { checklistId },
  } as CallableRequest)) as unknown as Record<string, unknown>;

  console.log(`[getProjectChecklist] OK: checklist ${checklistId} of project ${projectId} read by ${uid}`);
  return { checklistId, ...result };
});
