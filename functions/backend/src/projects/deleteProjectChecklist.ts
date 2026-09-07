import { onCall, HttpsError } from "firebase-functions/v2/https";
import type { CallableRequest } from "firebase-functions/v2/https";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { getInvokeId } from "../utils/invoke";
import { logSecurityEvent } from "../security/securityLog";
import { deleteChecklist } from "../organizer/deleteChecklist";
import {
  requireAdmin,
  getProjectOrThrow,
  assertProjectContentWritable,
  assertChecklistBelongsToProject,
} from "./projectAccess";

const REGION = "europe-west1";

type LogOutcome = "success" | "blocked" | "failure";

/**
 * Cloud Function callable del dominio "projects": elimina una checklist
 * collegata a un progetto e rimuove il riferimento da
 * `projects/{projectId}.checklists` (mirror di
 * `deleteDeviceRequestChecklist`, stessa cautela contro riferimenti orfani).
 *
 * Admin-only, bloccata fuori da `new`/`active`.
 */
export const deleteProjectChecklist = onCall({ region: REGION }, async (request) => {
  const invokeId = getInvokeId(request);
  console.log(`[deleteProjectChecklist] Invoke ID: ${invokeId} - Function called`);

  const uid = request.auth?.uid;
  const email = request.auth?.token?.email;

  async function logOutcome(outcome: LogOutcome, metadata: Record<string, unknown>): Promise<void> {
    await logSecurityEvent({
      type: "system",
      action: "deleteProjectChecklist",
      outcome,
      severity: outcome === "success" ? "low" : outcome === "failure" ? "high" : "medium",
      actor: { uid, email: email ?? undefined },
      context: { function: "deleteProjectChecklist", invokeId, metadata },
    });
  }

  if (!uid) {
    await logOutcome("blocked", { reason: "unauthenticated" });
    throw new HttpsError("unauthenticated", "Authentication required");
  }

  const { projectId, checklistId } = (request.data ?? {}) as {
    projectId?: string;
    checklistId?: string;
  };

  if (!projectId || typeof projectId !== "string") {
    await logOutcome("blocked", { reason: "invalid-argument", field: "projectId" });
    throw new HttpsError("invalid-argument", "Missing or invalid projectId");
  }
  if (!checklistId || typeof checklistId !== "string") {
    await logOutcome("blocked", { reason: "invalid-argument", field: "checklistId" });
    throw new HttpsError("invalid-argument", "Missing or invalid checklistId");
  }

  const db = getFirestore();

  try {
    await requireAdmin(db, uid);
  } catch (error) {
    await logOutcome("blocked", { reason: "permission-denied", projectId });
    throw error;
  }

  try {
    const project = await getProjectOrThrow(db, projectId);
    assertProjectContentWritable(project.status);
    assertChecklistBelongsToProject(project, checklistId);

    await deleteChecklist.run({
      ...request,
      data: { checklistId },
    } as CallableRequest);

    const remainingChecklists = project.checklists.filter((c) => c.checklistId !== checklistId);
    await db.collection("projects").doc(projectId).update({
      checklists: remainingChecklists,
      updatedAt: FieldValue.serverTimestamp(),
    });

    console.log(`[deleteProjectChecklist] OK: checklist ${checklistId} deleted from project ${projectId}`);
    await logOutcome("success", { projectId, checklistId });

    return { success: true };
  } catch (error) {
    if (error instanceof HttpsError) {
      await logOutcome("blocked", { reason: error.code, projectId, checklistId });
      throw error;
    }
    console.error("[deleteProjectChecklist] KO:", error);
    await logOutcome("failure", { reason: "unexpected-error", projectId, checklistId });
    throw new HttpsError("internal", "Internal Server Error");
  }
});
