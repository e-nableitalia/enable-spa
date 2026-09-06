import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { getApp } from "firebase-admin/app";
import { getInvokeId } from "../utils/invoke";
import { logSecurityEvent } from "../security/securityLog";
import { createAttachment, newAttachmentId } from "./attachmentModel";

const REGION = "europe-west1";

/**
 * Limite massimo di dimensione file, confermato dall'operatore come
 * "~20-50MB" (docs/implementation-requests/cross-entity-attachments-request.md,
 * sezione "Dimensione file e resumable upload/download"): nessun numero
 * esatto è stato fissato in quella sede, solo un ordine di grandezza — si
 * sceglie qui l'estremo superiore del range confermato.
 */
const MAX_ATTACHMENT_SIZE_BYTES = 50 * 1024 * 1024;

/**
 * TTL basso della signed URL di upload (decisione operatore, stesso
 * documento): il flusso atteso è "click → URL immediata → upload
 * immediato", non un link da conservare o riutilizzare più tardi.
 */
const UPLOAD_URL_TTL_MS = 5 * 60 * 1000;

/** Staff-only: admin e volontario, mai il richiedente/famiglia (RBAC deciso
 * a monte, non rinegoziabile in questa Story). */
const STAFF_ROLES = new Set(["admin", "volunteer"]);

type LogOutcome = "success" | "blocked";

/**
 * Cloud Function callable della capability di base "Allegati" (EA-161):
 * verifica RBAC staff-only, applica il limite di dimensione, genera una
 * signed URL V4 di upload a breve scadenza e associa i metadati
 * all'entità proprietaria, tramite il modulo condiviso `attachmentModel`
 * (EA-162).
 *
 * `entityType`/`entityId`/`entityCollectionPath` sono parametri opachi
 * passati dal chiamante (fuori scope: nessuna conoscenza di un consumer
 * specifico come `deviceRequest`, coerente con `attachmentModel.ts`).
 *
 * Ogni invocazione — successo o rifiuto — scrive un evento in
 * `securityLogs` con `action: "uploadAttachment"` tramite
 * `logSecurityEvent` (Scenario 6), a differenza di altre Cloud Function del
 * repo che loggano solo il successo (vedi `docs/FINDINGS.md` F-2): qui è un
 * requisito esplicito della Story, non solo la convenzione generale.
 */
export const uploadAttachment = onCall({ region: REGION }, async (request) => {
  const invokeId = getInvokeId(request);
  console.log(`[uploadAttachment] Invoke ID: ${invokeId} - Function called`);

  const uid = request.auth?.uid;
  const email = request.auth?.token?.email;

  async function logOutcome(
    outcome: LogOutcome,
    metadata: Record<string, unknown>
  ): Promise<void> {
    await logSecurityEvent({
      type: "security",
      action: "uploadAttachment",
      outcome,
      severity: outcome === "success" ? "low" : "medium",
      actor: { uid, email: email ?? undefined },
      context: { function: "uploadAttachment", invokeId, metadata },
    });
  }

  if (!uid) {
    console.log("[uploadAttachment] KO: Unauthenticated");
    await logOutcome("blocked", { reason: "unauthenticated" });
    throw new HttpsError("unauthenticated", "Authentication required");
  }

  const data = request.data ?? {};
  const {
    entityType,
    entityId,
    entityCollectionPath,
    fileName,
    description,
    notes,
    category,
    size,
  } = data;

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
  if (!fileName || typeof fileName !== "string") {
    await logOutcome("blocked", { reason: "invalid-argument", field: "fileName" });
    throw new HttpsError("invalid-argument", "Missing or invalid parameter: fileName");
  }
  if (notes !== undefined && typeof notes !== "string") {
    await logOutcome("blocked", { reason: "invalid-argument", field: "notes" });
    throw new HttpsError("invalid-argument", "notes must be a string");
  }
  if (category !== undefined && category !== null && typeof category !== "string") {
    await logOutcome("blocked", { reason: "invalid-argument", field: "category" });
    throw new HttpsError("invalid-argument", "category must be a string");
  }

  const db = getFirestore();

  const userSnap = await db.collection("users").doc(uid).get();
  const role = userSnap.exists ? userSnap.data()?.role : undefined;

  // Scenario 3: solo admin e volontario, mai il richiedente/famiglia (né
  // altri ruoli come organizer).
  if (!STAFF_ROLES.has(role)) {
    console.log(`[uploadAttachment] KO: Permission denied for uid ${uid} (role: ${role})`);
    await logOutcome("blocked", { reason: "permission-denied", entityType, entityId, role: role ?? null });
    throw new HttpsError(
      "permission-denied",
      "Only staff (admin or volunteer) can upload attachments"
    );
  }

  // Scenario 4: limite di dimensione applicato prima della generazione
  // della signed URL, nessun record creato.
  if (typeof size !== "number" || !Number.isFinite(size) || size <= 0) {
    await logOutcome("blocked", { reason: "invalid-argument", field: "size", entityType, entityId });
    throw new HttpsError("invalid-argument", "size must be a positive number");
  }
  if (size > MAX_ATTACHMENT_SIZE_BYTES) {
    console.log(
      `[uploadAttachment] KO: size ${size} exceeds the maximum allowed (${MAX_ATTACHMENT_SIZE_BYTES})`
    );
    await logOutcome("blocked", {
      reason: "size-exceeds-limit",
      entityType,
      entityId,
      size,
      maxSize: MAX_ATTACHMENT_SIZE_BYTES,
    });
    throw new HttpsError(
      "failed-precondition",
      `File exceeds the maximum allowed size of ${MAX_ATTACHMENT_SIZE_BYTES} bytes`
    );
  }

  // Scenario 5: descrizione obbligatoria, verificata prima della signed URL.
  if (!description || typeof description !== "string" || !description.trim()) {
    console.log("[uploadAttachment] KO: Missing or blank description");
    await logOutcome("blocked", { reason: "missing-description", entityType, entityId });
    throw new HttpsError("invalid-argument", "description is required");
  }

  const attachmentId = newAttachmentId(db);
  const storagePath = `attachments/${entityType}/${entityId}/${attachmentId}/${fileName}`;

  const projectId = getApp().options.projectId;
  if (!projectId) {
    throw new HttpsError("internal", "Project ID is required");
  }
  const bucket = getStorage().bucket(`${projectId}-attachments`);

  const [uploadUrl] = await bucket.file(storagePath).getSignedUrl({
    version: "v4",
    action: "write",
    expires: Date.now() + UPLOAD_URL_TTL_MS,
  });

  await createAttachment(
    db,
    entityCollectionPath,
    {
      entityType,
      entityId,
      uploadedBy: uid,
      description,
      notes,
      category,
      fileName,
      storagePath,
      size,
    },
    attachmentId
  );

  console.log(`[uploadAttachment] OK: attachment ${attachmentId} created for ${entityType}/${entityId}`);
  await logOutcome("success", { entityType, entityId, attachmentId });

  return { attachmentId, uploadUrl, storagePath };
});
