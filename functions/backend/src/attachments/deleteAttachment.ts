import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { getApp } from "firebase-admin/app";
import { getInvokeId } from "../utils/invoke";
import { logSecurityEvent } from "../security/securityLog";
import { getAttachmentById, deleteAttachmentRecord } from "./attachmentModel";

const REGION = "europe-west1";

type LogOutcome = "success" | "blocked" | "failure";

/**
 * Cloud Function callable `deleteAttachment` (EA-167): admin può eliminare
 * qualunque allegato, il volontario solo quelli caricati da sé stesso
 * (`uploadedBy === uid`) — stesso pattern ownership già in uso in
 * `updateAttachmentDescription` (EA-166) e in `deleteShipmentRequest`
 * (`functions/backend/src/shipments/shipmentRequests.ts`).
 *
 * A differenza di `deleteShipmentRequest` (soft delete, `status: "deleted"`),
 * qui l'eliminazione è reale e non reversibile su tutti e tre gli artefatti:
 * il file fisico nel bucket dedicato, il documento
 * `attachments/{attachmentId}` e l'entry indice nella subcollection
 * dell'entità proprietaria — coerentemente con l'assenza di un requisito di
 * soft-delete per questa capability. Il file viene eliminato per primo:
 * se l'eliminazione dei documenti Firestore fallisse dopo, resterebbe solo
 * un'eventuale entry di metadati orfana (nessun file scaricabile), mai un
 * file scaricabile senza più metadati.
 *
 * `entityCollectionPath` non è (più) un parametro del chiamante: a
 * differenza di `uploadAttachment`/`listAttachments`, qui viene letto dal
 * documento `attachments/{id}` già risolto (persistito lì da
 * `createAttachment`, F-42), non ri-accettato indipendentemente da
 * `request.data`. Un valore indipendente e potenzialmente disallineato
 * renderebbe l'eliminazione dell'entry indice un no-op silenzioso — trovato
 * dal panel review di questa stessa Story.
 */
export const deleteAttachment = onCall({ region: REGION }, async (request) => {
  const invokeId = getInvokeId(request);
  console.log(`[deleteAttachment] Invoke ID: ${invokeId} - Function called`);

  const uid = request.auth?.uid;
  const email = request.auth?.token?.email;

  async function logOutcome(
    outcome: LogOutcome,
    metadata: Record<string, unknown>
  ): Promise<void> {
    await logSecurityEvent({
      type: "security",
      action: "deleteAttachment",
      outcome,
      severity: outcome === "success" ? "low" : outcome === "failure" ? "high" : "medium",
      actor: { uid, email: email ?? undefined },
      context: { function: "deleteAttachment", invokeId, metadata },
    });
  }

  if (!uid) {
    console.log("[deleteAttachment] KO: Unauthenticated");
    await logOutcome("blocked", { reason: "unauthenticated" });
    throw new HttpsError("unauthenticated", "Authentication required");
  }

  const data = request.data ?? {};
  const { attachmentId } = data;

  if (!attachmentId || typeof attachmentId !== "string") {
    await logOutcome("blocked", { reason: "invalid-argument", field: "attachmentId" });
    throw new HttpsError("invalid-argument", "Missing or invalid parameter: attachmentId");
  }

  const db = getFirestore();

  const userSnap = await db.collection("users").doc(uid).get();
  const role = userSnap.exists ? userSnap.data()?.role : undefined;

  const attachment = await getAttachmentById(db, attachmentId);
  if (!attachment) {
    console.log(`[deleteAttachment] KO: Attachment ${attachmentId} not found`);
    await logOutcome("blocked", { reason: "not-found", attachmentId });
    throw new HttpsError("not-found", "Attachment not found");
  }

  // Scenario 1/2/3: admin elimina qualunque allegato, il volontario solo i
  // propri (attachment.uploadedBy === uid), stesso pattern ownership di
  // updateAttachmentDescription/deleteShipmentRequest.
  if (role !== "admin" && attachment.uploadedBy !== uid) {
    console.log(
      `[deleteAttachment] KO: uid ${uid} tried to delete another user's attachment ${attachmentId}`
    );
    await logOutcome("blocked", { reason: "permission-denied", attachmentId, role: role ?? null });
    throw new HttpsError("permission-denied", "Cannot delete another user's attachment");
  }

  try {
    const projectId = getApp().options.projectId;
    if (!projectId) {
      throw new HttpsError("internal", "Project ID is required");
    }
    const bucket = getStorage().bucket(`${projectId}-attachments`);
    await bucket.file(attachment.storagePath).delete();

    await deleteAttachmentRecord(db, attachment.entityCollectionPath, attachmentId, attachment.entityId);

    console.log(`[deleteAttachment] OK: attachment ${attachmentId} deleted by ${uid}`);
    await logOutcome("success", { attachmentId });

    return { attachmentId };
  } catch (error) {
    // Copre errori infrastrutturali imprevisti (file già assente dal bucket,
    // permessi IAM insufficienti, errore di rete Firestore/Storage): stessa
    // convenzione delle altre Cloud Function del modulo attachments
    // (F-2/EA-120).
    console.error("[deleteAttachment] KO:", error);
    await logOutcome("failure", { attachmentId, reason: "unexpected-error" });

    if (error instanceof HttpsError) {
      throw error;
    }
    throw new HttpsError("internal", "Internal Server Error");
  }
});
