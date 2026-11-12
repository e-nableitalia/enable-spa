import { onCall, HttpsError } from "firebase-functions/v2/https";
import type { CallableRequest } from "firebase-functions/v2/https";
import { getFirestore } from "firebase-admin/firestore";
import { getInvokeId } from "../utils/invoke";
import { logSecurityEvent } from "../security/securityLog";
import { deleteChecklist } from "../organizer/deleteChecklist";
import { getProjectOrThrow, requireAdmin } from "./projectAccess";

const REGION = "europe-west1";

type LogOutcome = "success" | "blocked" | "failure";

/**
 * Cloud Function callable del dominio "projects": elimina un progetto
 * (documento + eventi + checklist collegate). Admin-only.
 *
 * Ammessa anche su progetti terminali (`archived`/`closed`): l'eliminazione
 * è un'azione esplicita di pulizia, distinta dalle mutazioni di contenuto.
 */
export const deleteProject = onCall({ region: REGION }, async (request) => {
  const invokeId = getInvokeId(request);
  console.log(`[deleteProject] Invoke ID: ${invokeId} - Function called`);

  const uid = request.auth?.uid;
  const email = request.auth?.token?.email;

  async function logOutcome(outcome: LogOutcome, metadata: Record<string, unknown>): Promise<void> {
    await logSecurityEvent({
      type: "system",
      action: "deleteProject",
      outcome,
      severity: outcome === "success" ? "low" : outcome === "failure" ? "high" : "medium",
      actor: { uid, email: email ?? undefined },
      context: { function: "deleteProject", invokeId, metadata },
    });
  }

  if (!uid) {
    await logOutcome("blocked", { reason: "unauthenticated" });
    throw new HttpsError("unauthenticated", "Authentication required");
  }

  const { projectId } = (request.data ?? {}) as { projectId?: string };
  if (!projectId || typeof projectId !== "string") {
    await logOutcome("blocked", { reason: "invalid-argument", field: "projectId" });
    throw new HttpsError("invalid-argument", "Missing or invalid projectId");
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

    for (const ref of project.checklists) {
      await deleteChecklist.run({
        ...request,
        data: { checklistId: ref.checklistId },
      } as CallableRequest);
    }

    const eventsSnap = await db.collection("projects").doc(projectId).collection("events").get();
    const batch = db.batch();
    for (const eventDoc of eventsSnap.docs) {
      batch.delete(eventDoc.ref);
    }
    batch.delete(db.collection("projects").doc(projectId));
    await batch.commit();

    console.log(`[deleteProject] OK: project ${projectId} deleted by ${uid}`);
    await logOutcome("success", { projectId, checklistsDeleted: project.checklists.length });

    return { success: true };
  } catch (error) {
    if (error instanceof HttpsError) {
      await logOutcome("blocked", { reason: error.code, projectId });
      throw error;
    }
    console.error("[deleteProject] KO:", error);
    await logOutcome("failure", { reason: "unexpected-error", projectId });
    throw new HttpsError("internal", "Internal Server Error");
  }
});
