import { onCall, HttpsError } from "firebase-functions/v2/https";
import type { CallableRequest } from "firebase-functions/v2/https";
import { getFirestore } from "firebase-admin/firestore";
import { getInvokeId } from "../utils/invoke";
import { downloadAttachment } from "../attachments/downloadAttachment";
import { resolveDeviceRequestAttachment } from "./deviceRequestAttachmentAccess";

const REGION = "europe-west1";

/**
 * Cloud Function callable del layer di integrazione device-requests
 * (EA-168): genera una signed URL di download per un allegato collegato
 * a una `deviceRequest`.
 *
 * `resolveDeviceRequestAttachment` verifica sia l'RBAC di
 * device-requests (admin, o volontario assegnato) sia che l'allegato
 * risolto appartenga davvero a `requestId` — prima di delegare alla
 * Cloud Function generica `downloadAttachment`.
 */
export const downloadDeviceRequestAttachment = onCall({ region: REGION }, async (request) => {
  const invokeId = getInvokeId(request);
  console.log(`[downloadDeviceRequestAttachment] Invoke ID: ${invokeId} - Function called`);

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

  const result = (await downloadAttachment.run({
    ...request,
    data: { attachmentId },
  } as CallableRequest)) as { attachmentId: string; downloadUrl: string; fileName: string };

  console.log(
    `[downloadDeviceRequestAttachment] OK: delegated to downloadAttachment for request ${requestId} by ${uid}`
  );
  return result;
});
