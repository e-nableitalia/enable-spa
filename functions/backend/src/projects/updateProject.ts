import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { getInvokeId } from "../utils/invoke";
import { logSecurityEvent } from "../security/securityLog";
import { requireAdmin, getProjectOrThrow, assertProjectContentWritable } from "./projectAccess";

const REGION = "europe-west1";

type LogOutcome = "success" | "blocked" | "failure";

/**
 * Cloud Function callable del dominio "projects": aggiorna titolo e/o
 * descrizione di un progetto esistente, admin-only, bloccata fuori da
 * `new`/`active` (`assertProjectContentWritable`).
 */
export const updateProject = onCall({ region: REGION }, async (request) => {
  const invokeId = getInvokeId(request);
  console.log(`[updateProject] Invoke ID: ${invokeId} - Function called`);

  const uid = request.auth?.uid;
  const email = request.auth?.token?.email;

  async function logOutcome(outcome: LogOutcome, metadata: Record<string, unknown>): Promise<void> {
    await logSecurityEvent({
      type: "system",
      action: "updateProject",
      outcome,
      severity: outcome === "success" ? "low" : outcome === "failure" ? "high" : "medium",
      actor: { uid, email: email ?? undefined },
      context: { function: "updateProject", invokeId, metadata },
    });
  }

  if (!uid) {
    await logOutcome("blocked", { reason: "unauthenticated" });
    throw new HttpsError("unauthenticated", "Authentication required");
  }

  const { projectId, title, description } = (request.data ?? {}) as {
    projectId?: string;
    title?: string;
    description?: string;
  };

  if (!projectId || typeof projectId !== "string") {
    await logOutcome("blocked", { reason: "invalid-argument", field: "projectId" });
    throw new HttpsError("invalid-argument", "Missing or invalid projectId");
  }
  if (title !== undefined && (typeof title !== "string" || !title.trim())) {
    await logOutcome("blocked", { reason: "invalid-argument", field: "title" });
    throw new HttpsError("invalid-argument", "title must be a non-empty string");
  }
  if (description !== undefined && typeof description !== "string") {
    await logOutcome("blocked", { reason: "invalid-argument", field: "description" });
    throw new HttpsError("invalid-argument", "description must be a string");
  }
  if (title === undefined && description === undefined) {
    await logOutcome("blocked", { reason: "invalid-argument", field: "none" });
    throw new HttpsError("invalid-argument", "Nothing to update");
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

    const updates: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() };
    if (title !== undefined) updates.title = title.trim();
    if (description !== undefined) updates.description = description;

    await db.collection("projects").doc(projectId).update(updates);

    console.log(`[updateProject] OK: project ${projectId} updated by ${uid}`);
    await logOutcome("success", { projectId });

    return { success: true };
  } catch (error) {
    if (error instanceof HttpsError) {
      await logOutcome("blocked", { reason: error.code, projectId });
      throw error;
    }
    console.error("[updateProject] KO:", error);
    await logOutcome("failure", { reason: "unexpected-error", projectId });
    throw new HttpsError("internal", "Internal Server Error");
  }
});
