import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore } from "firebase-admin/firestore";
import { getInvokeId } from "../utils/invoke";
import { logSecurityEvent } from "../security/securityLog";
import { getAttachmentById, updateAttachmentFields } from "./attachmentModel";

const REGION = "europe-west1";

type LogOutcome = "success" | "blocked" | "failure";

/**
 * Cloud Function callable `updateAttachmentDescription` (EA-166): admin può
 * modificare descrizione e note di qualunque allegato; il volontario solo
 * di quelli caricati da sé stesso (`uploadedBy === uid`) — stesso pattern
 * ownership già in uso in `deleteShipmentRequest`
 * (`functions/backend/src/shipments/shipmentRequests.ts`), qui applicato a
 * modifica invece che eliminazione: ruolo letto da `users/{uid}`, se non
 * admin si confronta l'ownership del documento invece di un controllo
 * staff-only generico.
 *
 * La descrizione resta il campo obbligatorio del modello dati (Scenario 4):
 * validata solo dopo il controllo RBAC, coerente con la premessa dello
 * scenario ("di cui il chiamante ha diritto di modifica secondo gli
 * scenari precedenti") — nessuna scrittura avviene se rifiutata, il valore
 * precedente resta invariato.
 */
export const updateAttachmentDescription = onCall({ region: REGION }, async (request) => {
  const invokeId = getInvokeId(request);
  console.log(`[updateAttachmentDescription] Invoke ID: ${invokeId} - Function called`);

  const uid = request.auth?.uid;
  const email = request.auth?.token?.email;

  async function logOutcome(
    outcome: LogOutcome,
    metadata: Record<string, unknown>
  ): Promise<void> {
    await logSecurityEvent({
      type: "security",
      action: "updateAttachmentDescription",
      outcome,
      severity: outcome === "success" ? "low" : outcome === "failure" ? "high" : "medium",
      actor: { uid, email: email ?? undefined },
      context: { function: "updateAttachmentDescription", invokeId, metadata },
    });
  }

  if (!uid) {
    console.log("[updateAttachmentDescription] KO: Unauthenticated");
    await logOutcome("blocked", { reason: "unauthenticated" });
    throw new HttpsError("unauthenticated", "Authentication required");
  }

  const data = request.data ?? {};
  const { attachmentId, description, notes } = data;

  if (!attachmentId || typeof attachmentId !== "string") {
    await logOutcome("blocked", { reason: "invalid-argument", field: "attachmentId" });
    throw new HttpsError("invalid-argument", "Missing or invalid parameter: attachmentId");
  }
  if (notes !== undefined && typeof notes !== "string") {
    await logOutcome("blocked", { reason: "invalid-argument", field: "notes", attachmentId });
    throw new HttpsError("invalid-argument", "notes must be a string");
  }

  const db = getFirestore();

  const userSnap = await db.collection("users").doc(uid).get();
  const role = userSnap.exists ? userSnap.data()?.role : undefined;

  const attachment = await getAttachmentById(db, attachmentId);
  if (!attachment) {
    console.log(`[updateAttachmentDescription] KO: Attachment ${attachmentId} not found`);
    await logOutcome("blocked", { reason: "not-found", attachmentId });
    throw new HttpsError("not-found", "Attachment not found");
  }

  // Scenario 1/2/3: admin modifica qualunque allegato, il volontario solo i
  // propri (attachment.uploadedBy === uid), stesso pattern ownership di
  // deleteShipmentRequest.
  if (role !== "admin" && attachment.uploadedBy !== uid) {
    console.log(
      `[updateAttachmentDescription] KO: uid ${uid} tried to modify another user's attachment ${attachmentId}`
    );
    await logOutcome("blocked", { reason: "permission-denied", attachmentId, role: role ?? null });
    throw new HttpsError("permission-denied", "Cannot modify another user's attachment");
  }

  // Scenario 4: descrizione vuota o mancante rifiutata dopo il controllo
  // RBAC — nessuna scrittura avviene, il valore precedente resta invariato.
  if (!description || typeof description !== "string" || !description.trim()) {
    console.log("[updateAttachmentDescription] KO: Missing or blank description");
    await logOutcome("blocked", { reason: "missing-description", attachmentId });
    throw new HttpsError("invalid-argument", "description is required");
  }

  try {
    await updateAttachmentFields(db, attachmentId, { description, notes });

    console.log(`[updateAttachmentDescription] OK: attachment ${attachmentId} updated by ${uid}`);
    await logOutcome("success", { attachmentId });

    return {
      attachmentId,
      description,
      notes: notes ?? attachment.notes,
    };
  } catch (error) {
    // Copre errori infrastrutturali imprevisti (errore di rete Firestore,
    // ecc.): stessa convenzione delle altre Cloud Function del modulo
    // attachments (F-2/EA-120).
    console.error("[updateAttachmentDescription] KO:", error);
    await logOutcome("failure", { attachmentId, reason: "unexpected-error" });

    if (error instanceof HttpsError) {
      throw error;
    }
    throw new HttpsError("internal", "Internal Server Error");
  }
});
