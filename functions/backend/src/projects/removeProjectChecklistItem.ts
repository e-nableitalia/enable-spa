import { onCall, HttpsError } from "firebase-functions/v2/https";
import type { CallableRequest } from "firebase-functions/v2/https";
import { getFirestore } from "firebase-admin/firestore";
import { getInvokeId } from "../utils/invoke";
import { logSecurityEvent } from "../security/securityLog";
import { removeChecklistItem } from "../organizer/removeChecklistItem";
import {
  requireStaffRole,
  getProjectOrThrow,
  assertProjectContentWritable,
  assertChecklistBelongsToProject,
} from "./projectAccess";

const REGION = "europe-west1";

type LogOutcome = "success" | "blocked" | "failure";

/**
 * Cloud Function callable del dominio "projects": rimuove un item dalla
 * checklist collegata a un progetto. Admin+volontario, bloccata fuori da
 * `new`/`active`.
 */
export const removeProjectChecklistItem = onCall({ region: REGION }, async (request) => {
  const invokeId = getInvokeId(request);
  console.log(`[removeProjectChecklistItem] Invoke ID: ${invokeId} - Function called`);

  const uid = request.auth?.uid;
  const email = request.auth?.token?.email;

  async function logOutcome(outcome: LogOutcome, metadata: Record<string, unknown>): Promise<void> {
    await logSecurityEvent({
      type: "system",
      action: "removeProjectChecklistItem",
      outcome,
      severity: outcome === "success" ? "low" : outcome === "failure" ? "high" : "medium",
      actor: { uid, email: email ?? undefined },
      context: { function: "removeProjectChecklistItem", invokeId, metadata },
    });
  }

  if (!uid) {
    await logOutcome("blocked", { reason: "unauthenticated" });
    throw new HttpsError("unauthenticated", "Authentication required");
  }

  const { projectId, checklistId, itemId } = (request.data ?? {}) as {
    projectId?: string;
    checklistId?: string;
    itemId?: string;
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
    await requireStaffRole(db, uid);
  } catch (error) {
    await logOutcome("blocked", { reason: "permission-denied", projectId });
    throw error;
  }

  try {
    const project = await getProjectOrThrow(db, projectId);
    assertProjectContentWritable(project.status);
    assertChecklistBelongsToProject(project, checklistId);

    const result = (await removeChecklistItem.run({
      ...request,
      data: { checklistId, itemId },
    } as CallableRequest)) as { success: boolean };

    console.log(
      `[removeProjectChecklistItem] OK: item ${itemId} removed from checklist ${checklistId} of project ${projectId} by ${uid}`
    );
    await logOutcome("success", { projectId, checklistId, itemId });

    return result;
  } catch (error) {
    if (error instanceof HttpsError) {
      await logOutcome("blocked", { reason: error.code, projectId, checklistId, itemId });
      throw error;
    }
    console.error("[removeProjectChecklistItem] KO:", error);
    await logOutcome("failure", { reason: "unexpected-error", projectId, checklistId, itemId });
    throw new HttpsError("internal", "Internal Server Error");
  }
});
