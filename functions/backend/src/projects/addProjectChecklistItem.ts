import { onCall, HttpsError } from "firebase-functions/v2/https";
import type { CallableRequest } from "firebase-functions/v2/https";
import { getFirestore } from "firebase-admin/firestore";
import { getInvokeId } from "../utils/invoke";
import { logSecurityEvent } from "../security/securityLog";
import { addChecklistItem } from "../organizer/addChecklistItem";
import {
  requireStaffRole,
  getProjectOrThrow,
  assertProjectContentWritable,
  assertChecklistBelongsToProject,
  isResolvableProjectAssignee,
} from "./projectAccess";

const REGION = "europe-west1";

type LogOutcome = "success" | "blocked" | "failure";

/**
 * Cloud Function callable del dominio "projects": aggiunge un item alla
 * checklist collegata a un progetto. Admin+volontario (nessuna restrizione
 * di "assegnato a questo progetto", a differenza di device-requests),
 * bloccata fuori da `new`/`active`.
 */
export const addProjectChecklistItem = onCall({ region: REGION }, async (request) => {
  const invokeId = getInvokeId(request);
  console.log(`[addProjectChecklistItem] Invoke ID: ${invokeId} - Function called`);

  const uid = request.auth?.uid;
  const email = request.auth?.token?.email;

  async function logOutcome(outcome: LogOutcome, metadata: Record<string, unknown>): Promise<void> {
    await logSecurityEvent({
      type: "system",
      action: "addProjectChecklistItem",
      outcome,
      severity: outcome === "success" ? "low" : outcome === "failure" ? "high" : "medium",
      actor: { uid, email: email ?? undefined },
      context: { function: "addProjectChecklistItem", invokeId, metadata },
    });
  }

  if (!uid) {
    await logOutcome("blocked", { reason: "unauthenticated" });
    throw new HttpsError("unauthenticated", "Authentication required");
  }

  const { projectId, checklistId, title, type, assignee, quantity, notes } = (request.data ?? {}) as {
    projectId?: string;
    checklistId?: string;
    title?: string;
    type?: string;
    assignee?: string | null;
    quantity?: number | null;
    notes?: string | null;
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

    if (assignee !== undefined && assignee !== null) {
      if (typeof assignee !== "string" || !(await isResolvableProjectAssignee(db, assignee))) {
        throw new HttpsError(
          "invalid-argument",
          "Assignee must be the Firebase uid of an admin or an active volunteer"
        );
      }
    }

    const result = (await addChecklistItem.run({
      ...request,
      data: { checklistId, title, type, assignee, quantity, notes },
    } as CallableRequest)) as { itemId: string };

    console.log(
      `[addProjectChecklistItem] OK: item ${result.itemId} added to checklist ${checklistId} of project ${projectId}`
    );
    await logOutcome("success", { projectId, checklistId, itemId: result.itemId });

    return result;
  } catch (error) {
    if (error instanceof HttpsError) {
      await logOutcome("blocked", { reason: error.code, projectId, checklistId });
      throw error;
    }
    console.error("[addProjectChecklistItem] KO:", error);
    await logOutcome("failure", { reason: "unexpected-error", projectId, checklistId });
    throw new HttpsError("internal", "Internal Server Error");
  }
});
