import { onCall, HttpsError } from "firebase-functions/v2/https";
import type { CallableRequest } from "firebase-functions/v2/https";
import { getFirestore } from "firebase-admin/firestore";
import { getInvokeId } from "../utils/invoke";
import { deleteAttachment } from "../attachments/deleteAttachment";
import { resolveDeviceRequestAttachment } from "./deviceRequestAttachmentAccess";

const REGION = "europe-west1";

/**
 * Cloud Function callable del layer di integrazione device-requests
 * (EA-168): elimina un allegato collegato a una `deviceRequest`.
 *
 * `resolveDeviceRequestAttachment` verifica sia l'RBAC di
 * device-requests (admin, o volontario assegnato) sia che l'allegato
 * risolto appartenga davvero a `requestId`, prima di delegare alla Cloud
 * Function generica `deleteAttachment` — che applica a sua volta il
 * proprio RBAC di ownership (admin su qualunque allegato, il volontario
 * solo sui propri) e le protezioni F-42/F-43/F-44 già in vigore.
 */
export const deleteDeviceRequestAttachment = onCall({ region: REGION }, async (request) => {
  const invokeId = getInvokeId(request);
  console.log(`[deleteDeviceRequestAttachment] Invoke ID: ${invokeId} - Function called`);

  const uid = request.auth?.uid;
  if (!uid) {
    throw new HttpsError("unauthenticated", "User must be authenticated");
  }

  const { requestId, attachmentId } = request.data as {
    requestId?: string;
    attachmentId?: string;
  };

  if (!requestId || typeof requestId !== "string") {
    throw new HttpsError("invalid-argument", "Missing parameter: requestId");
  }
  if (!attachmentId || typeof attachmentId !== "string") {
    throw new HttpsError("invalid-argument", "Missing parameter: attachmentId");
  }

  const db = getFirestore();
  await resolveDeviceRequestAttachment(db, uid, requestId, attachmentId);

  const result = (await deleteAttachment.run({
    ...request,
    data: { attachmentId },
  } as CallableRequest)) as { attachmentId: string };

  console.log(
    `[deleteDeviceRequestAttachment] OK: delegated to deleteAttachment for request ${requestId} by ${uid}`
  );
  return result;
});
