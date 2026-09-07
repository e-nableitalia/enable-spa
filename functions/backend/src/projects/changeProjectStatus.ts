import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { getInvokeId } from "../utils/invoke";
import { logSecurityEvent } from "../security/securityLog";
import { requireAdmin, getProjectOrThrow, assertProjectNotTerminal, isValidProjectStatus } from "./projectAccess";

const REGION = "europe-west1";

type LogOutcome = "success" | "blocked" | "failure";

/**
 * Cloud Function callable del dominio "projects": cambia lo stato di un
 * progetto e/o aggiunge una nota alla sua cronologia, admin-only.
 *
 * Una "nota" senza cambio di stato reale è modellata passando
 * `newStatus === status` corrente (stesso trucco già usato da
 * `RequestDetail.handleAddNote` per `deviceRequests`): viene comunque
 * scritto un evento in `projects/{projectId}/events/{eventId}` con
 * `fromStatus === toStatus`.
 *
 * Bloccata solo se lo stato corrente è già terminale (`archived`/`closed`,
 * `assertProjectNotTerminal`) — a differenza delle altre mutazioni di
 * contenuto, qui `standby` NON blocca: sia l'aggiunta di una nota sia una
 * transizione di stato vera e propria restano permesse in `standby` (regola
 * esplicita dell'operatore, altrimenti `standby` sarebbe un vicolo cieco).
 */
export const changeProjectStatus = onCall({ region: REGION }, async (request) => {
  const invokeId = getInvokeId(request);
  console.log(`[changeProjectStatus] Invoke ID: ${invokeId} - Function called`);

  const uid = request.auth?.uid;
  const email = request.auth?.token?.email;

  async function logOutcome(outcome: LogOutcome, metadata: Record<string, unknown>): Promise<void> {
    await logSecurityEvent({
      type: "system",
      action: "changeProjectStatus",
      outcome,
      severity: outcome === "success" ? "low" : outcome === "failure" ? "high" : "medium",
      actor: { uid, email: email ?? undefined },
      context: { function: "changeProjectStatus", invokeId, metadata },
    });
  }

  if (!uid) {
    await logOutcome("blocked", { reason: "unauthenticated" });
    throw new HttpsError("unauthenticated", "Authentication required");
  }

  const { projectId, newStatus, note } = (request.data ?? {}) as {
    projectId?: string;
    newStatus?: string;
    note?: string;
  };

  if (!projectId || typeof projectId !== "string") {
    await logOutcome("blocked", { reason: "invalid-argument", field: "projectId" });
    throw new HttpsError("invalid-argument", "Missing or invalid projectId");
  }
  if (!isValidProjectStatus(newStatus)) {
    await logOutcome("blocked", { reason: "invalid-argument", field: "newStatus" });
    throw new HttpsError("invalid-argument", "Missing or invalid newStatus");
  }
  if (note !== undefined && typeof note !== "string") {
    await logOutcome("blocked", { reason: "invalid-argument", field: "note" });
    throw new HttpsError("invalid-argument", "note must be a string");
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
    assertProjectNotTerminal(project.status);

    const projectRef = db.collection("projects").doc(projectId);
    const eventRef = projectRef.collection("events").doc();

    const batch = db.batch();
    batch.set(eventRef, {
      fromStatus: project.status,
      toStatus: newStatus,
      note: note ?? "",
      createdBy: uid,
      timestamp: FieldValue.serverTimestamp(),
    });
    batch.update(projectRef, {
      status: newStatus,
      updatedAt: FieldValue.serverTimestamp(),
    });
    await batch.commit();

    console.log(
      `[changeProjectStatus] OK: project ${projectId} ${project.status} -> ${newStatus} by ${uid}`
    );
    await logOutcome("success", { projectId, fromStatus: project.status, toStatus: newStatus });

    return { success: true, eventId: eventRef.id };
  } catch (error) {
    if (error instanceof HttpsError) {
      await logOutcome("blocked", { reason: error.code, projectId });
      throw error;
    }
    console.error("[changeProjectStatus] KO:", error);
    await logOutcome("failure", { reason: "unexpected-error", projectId });
    throw new HttpsError("internal", "Internal Server Error");
  }
});
