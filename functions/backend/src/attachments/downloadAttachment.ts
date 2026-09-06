import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { getApp } from "firebase-admin/app";
import { getInvokeId } from "../utils/invoke";
import { logSecurityEvent } from "../security/securityLog";
import { getAttachmentById } from "./attachmentModel";

const REGION = "europe-west1";

/**
 * Stesso TTL basso della signed URL di upload (decisione operatore,
 * docs/implementation-requests/cross-entity-attachments-request.md, sezione
 * "TTL della signed URL"): il flusso atteso è "click sull'allegato → URL
 * generata al momento → download immediato", non un link da conservare o
 * riutilizzare più tardi.
 */
const DOWNLOAD_URL_TTL_MS = 5 * 60 * 1000;

/** Staff-only: admin e volontario, mai il richiedente/famiglia (stessa
 * decisione RBAC di `uploadAttachment`/`listAttachments`, nessuna
 * differenziazione di ownership per il download — Scenario 2). */
const STAFF_ROLES = new Set(["admin", "volunteer"]);

type LogOutcome = "success" | "blocked" | "failure";

/**
 * Cloud Function callable `downloadAttachment` (EA-165): verifica RBAC
 * staff-only e genera una signed URL V4 di download a breve scadenza per
 * l'allegato indicato da `attachmentId`, risolto direttamente dal catalogo
 * di primo livello `attachments/{attachmentId}` (`getAttachmentById`,
 * EA-162) — non serve passare dall'indice subcollection dell'entità
 * proprietaria, il chiamante conosce già l'id (click su un allegato già
 * elencato da `listAttachments`).
 *
 * Logging (Scenario 4, F-39): si traccia solo l'evento di emissione della
 * signed URL tramite `logSecurityEvent` — nessun meccanismo osserva se il
 * download effettivo viene poi completato dal client (nessun trigger GCS
 * nativo equivalente a `onObjectFinalized` per il download, decisione già
 * chiusa in docs/implementation-requests/cross-entity-attachments-request.md,
 * sezione "Logging e ciclo di vita del download").
 */
export const downloadAttachment = onCall({ region: REGION }, async (request) => {
  const invokeId = getInvokeId(request);
  console.log(`[downloadAttachment] Invoke ID: ${invokeId} - Function called`);

  const uid = request.auth?.uid;
  const email = request.auth?.token?.email;

  async function logOutcome(
    outcome: LogOutcome,
    metadata: Record<string, unknown>
  ): Promise<void> {
    await logSecurityEvent({
      type: "security",
      action: "downloadAttachment",
      outcome,
      severity: outcome === "success" ? "low" : outcome === "failure" ? "high" : "medium",
      actor: { uid, email: email ?? undefined },
      context: { function: "downloadAttachment", invokeId, metadata },
    });
  }

  if (!uid) {
    console.log("[downloadAttachment] KO: Unauthenticated");
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

  // Scenario 3: solo admin e volontario, mai il richiedente/famiglia (né
  // altri ruoli come organizer).
  if (!STAFF_ROLES.has(role)) {
    console.log(`[downloadAttachment] KO: Permission denied for uid ${uid} (role: ${role})`);
    await logOutcome("blocked", { reason: "permission-denied", attachmentId, role: role ?? null });
    throw new HttpsError(
      "permission-denied",
      "Only staff (admin or volunteer) can download attachments"
    );
  }

  const attachment = await getAttachmentById(db, attachmentId);
  if (!attachment) {
    console.log(`[downloadAttachment] KO: Attachment ${attachmentId} not found`);
    await logOutcome("blocked", { reason: "not-found", attachmentId });
    throw new HttpsError("not-found", "Attachment not found");
  }

  try {
    const projectId = getApp().options.projectId;
    if (!projectId) {
      throw new HttpsError("internal", "Project ID is required");
    }
    const bucket = getStorage().bucket(`${projectId}-attachments`);

    const [downloadUrl] = await bucket.file(attachment.storagePath).getSignedUrl({
      version: "v4",
      action: "read",
      expires: Date.now() + DOWNLOAD_URL_TTL_MS,
    });

    // Scenario 4: si logga solo l'emissione della signed URL, qui — nessun
    // logging separato "inizio"/"completamento" del download effettivo.
    console.log(`[downloadAttachment] OK: signed URL issued for attachment ${attachmentId}`);
    await logOutcome("success", { attachmentId });

    return { attachmentId, downloadUrl, fileName: attachment.fileName };
  } catch (error) {
    // Copre errori infrastrutturali imprevisti (bucket non ancora
    // provisionato, permessi IAM insufficienti, errore di rete Storage):
    // stessa convenzione di `uploadAttachment` (F-2/EA-120).
    console.error("[downloadAttachment] KO:", error);
    await logOutcome("failure", { attachmentId, reason: "unexpected-error" });

    if (error instanceof HttpsError) {
      throw error;
    }
    throw new HttpsError("internal", "Internal Server Error");
  }
});
