import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore } from "firebase-admin/firestore";
import { getInvokeId } from "../utils/invoke";
import { logSecurityEvent } from "../security/securityLog";
import { listAttachmentsForEntity } from "./attachmentModel";

const REGION = "europe-west1";

/** Staff-only: admin e volontario, mai il richiedente/famiglia (stessa
 * decisione RBAC di `uploadAttachment`, nessuna differenziazione di
 * ownership in lettura tra admin e volontario). */
const STAFF_ROLES = new Set(["admin", "volunteer"]);

type LogOutcome = "success" | "blocked" | "failure";

/**
 * Cloud Function callable `listAttachments` (EA-164): dato
 * `entityType`/`entityId`/`entityCollectionPath`, restituisce l'elenco
 * completo degli allegati associati all'entità, letti tramite l'indice
 * subcollection introdotto da `attachmentModel` (EA-162) e risolti con i
 * metadati completi (`listAttachmentsForEntity`).
 *
 * Visibilità solo staff (admin+volontario): mai il richiedente/famiglia,
 * distinta dallo share-link di sola consultazione già esistente su altre
 * checklist (EA-113). Nessuna differenziazione di ownership in lettura:
 * admin e volontario vedono lo stesso elenco completo (Scenario 2).
 *
 * Ogni invocazione registra l'esito in `securityLogs` tramite
 * `logSecurityEvent`, stessa convenzione di `uploadAttachment`.
 */
export const listAttachments = onCall({ region: REGION }, async (request) => {
  const invokeId = getInvokeId(request);
  console.log(`[listAttachments] Invoke ID: ${invokeId} - Function called`);

  const uid = request.auth?.uid;
  const email = request.auth?.token?.email;

  async function logOutcome(
    outcome: LogOutcome,
    metadata: Record<string, unknown>
  ): Promise<void> {
    await logSecurityEvent({
      type: "security",
      action: "listAttachments",
      outcome,
      severity: outcome === "success" ? "low" : outcome === "failure" ? "high" : "medium",
      actor: { uid, email: email ?? undefined },
      context: { function: "listAttachments", invokeId, metadata },
    });
  }

  if (!uid) {
    console.log("[listAttachments] KO: Unauthenticated");
    await logOutcome("blocked", { reason: "unauthenticated" });
    throw new HttpsError("unauthenticated", "Authentication required");
  }

  const data = request.data ?? {};
  const { entityType, entityId, entityCollectionPath } = data;

  if (!entityType || typeof entityType !== "string") {
    await logOutcome("blocked", { reason: "invalid-argument", field: "entityType" });
    throw new HttpsError("invalid-argument", "Missing or invalid parameter: entityType");
  }
  if (!entityId || typeof entityId !== "string") {
    await logOutcome("blocked", { reason: "invalid-argument", field: "entityId" });
    throw new HttpsError("invalid-argument", "Missing or invalid parameter: entityId");
  }
  if (!entityCollectionPath || typeof entityCollectionPath !== "string") {
    await logOutcome("blocked", { reason: "invalid-argument", field: "entityCollectionPath" });
    throw new HttpsError("invalid-argument", "Missing or invalid parameter: entityCollectionPath");
  }

  const db = getFirestore();

  const userSnap = await db.collection("users").doc(uid).get();
  const role = userSnap.exists ? userSnap.data()?.role : undefined;

  // Scenario 3: solo admin e volontario, mai il richiedente/famiglia (né
  // altri ruoli come organizer).
  if (!STAFF_ROLES.has(role)) {
    console.log(`[listAttachments] KO: Permission denied for uid ${uid} (role: ${role})`);
    await logOutcome("blocked", { reason: "permission-denied", entityType, entityId, role: role ?? null });
    throw new HttpsError(
      "permission-denied",
      "Only staff (admin or volunteer) can list attachments"
    );
  }

  try {
    const attachments = await listAttachmentsForEntity(db, entityCollectionPath, entityId);

    console.log(`[listAttachments] OK: ${attachments.length} attachment(s) for ${entityType}/${entityId}`);
    await logOutcome("success", { entityType, entityId, count: attachments.length });

    return { attachments };
  } catch (error) {
    console.error("[listAttachments] KO:", error);
    await logOutcome("failure", { entityType, entityId, reason: "unexpected-error" });

    if (error instanceof HttpsError) {
      throw error;
    }
    throw new HttpsError("internal", "Internal Server Error");
  }
});
