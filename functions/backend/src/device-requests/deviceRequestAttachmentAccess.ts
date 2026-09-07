import { HttpsError } from "firebase-functions/v2/https";
import type { Firestore } from "firebase-admin/firestore";
import { getAttachmentById, AttachmentRecord } from "../attachments/attachmentModel";

/**
 * Risoluzione di accesso agli allegati collegati a una `deviceRequest`
 * (EA-168), condivisa da tutte le Cloud Function wrapper del layer
 * device-requests (`uploadDeviceRequestAttachment`,
 * `listDeviceRequestAttachments`, `downloadDeviceRequestAttachment`,
 * `updateDeviceRequestAttachmentDescription`,
 * `deleteDeviceRequestAttachment`).
 *
 * RBAC: stesso perimetro di `resolveDeviceRequestChecklistAccess` —
 * admin su qualsiasi richiesta, volontario solo se presente in
 * `assignedVolunteers` della `deviceRequest`. La capability di base
 * "Allegati" applica un RBAC generico più permissivo (staff-only,
 * qualunque admin/volontario); questo layer aggiunge il vincolo più
 * stretto specifico di device-requests, senza sostituire l'RBAC interno
 * delle Cloud Function generiche (che resta comunque in vigore quando il
 * wrapper delega via `.run()`).
 */
export async function resolveDeviceRequestAttachmentAccess(
  db: Firestore,
  uid: string,
  requestId: string
): Promise<{ assignedVolunteers: string[] }> {
  const requestRef = db.collection("deviceRequests").doc(requestId);
  const requestSnap = await requestRef.get();

  if (!requestSnap.exists) {
    throw new HttpsError("not-found", "Device request not found");
  }

  const requestData = requestSnap.data() ?? {};
  const assignedVolunteers: string[] = Array.isArray(requestData.assignedVolunteers)
    ? requestData.assignedVolunteers.filter((v: unknown): v is string => typeof v === "string")
    : [];

  const userSnap = await db.collection("users").doc(uid).get();
  const role = userSnap.exists ? userSnap.data()?.role : undefined;

  const isAdmin = role === "admin";
  const isAssignedVolunteer = role === "volunteer" && assignedVolunteers.includes(uid);

  if (!isAdmin && !isAssignedVolunteer) {
    throw new HttpsError(
      "permission-denied",
      "Only admin or assigned volunteers can access attachments for this request"
    );
  }

  return { assignedVolunteers };
}

/**
 * Variante usata dai wrapper che operano su un `attachmentId` già
 * esistente (download/update/delete): oltre all'RBAC di
 * `resolveDeviceRequestAttachmentAccess`, verifica che l'allegato
 * risolto appartenga davvero a `requestId` (`entityType === "deviceRequest"`
 * ed `entityId === requestId`) — stesso principio di
 * `checklistIds.includes(checklistId)` nel pattern checklist, per
 * impedire che un volontario assegnato alla richiesta A usi il proprio
 * `requestId` per agire su un allegato in realtà appartenente alla
 * richiesta B.
 */
export async function resolveDeviceRequestAttachment(
  db: Firestore,
  uid: string,
  requestId: string,
  attachmentId: string
): Promise<AttachmentRecord> {
  await resolveDeviceRequestAttachmentAccess(db, uid, requestId);

  const attachment = await getAttachmentById(db, attachmentId);
  if (!attachment) {
    throw new HttpsError("not-found", "Attachment not found");
  }
  if (attachment.entityType !== "deviceRequest" || attachment.entityId !== requestId) {
    throw new HttpsError("not-found", "Attachment not linked to this device request");
  }

  return attachment;
}
