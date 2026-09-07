import { onCall, HttpsError } from "firebase-functions/v2/https";
import type { CallableRequest } from "firebase-functions/v2/https";
import { getFirestore } from "firebase-admin/firestore";
import { getInvokeId } from "../utils/invoke";
import { updateAttachmentDescription } from "../attachments/updateAttachmentDescription";
import { resolveDeviceRequestAttachment } from "./deviceRequestAttachmentAccess";

const REGION = "europe-west1";

/**
 * Cloud Function callable del layer di integrazione device-requests
 * (EA-168): modifica descrizione/note di un allegato collegato a una
 * `deviceRequest`.
 *
 * `resolveDeviceRequestAttachment` verifica sia l'RBAC di
 * device-requests (admin, o volontario assegnato) sia che l'allegato
 * risolto appartenga davvero a `requestId`, prima di delegare alla Cloud
 * Function generica `updateAttachmentDescription` — che applica a sua
 * volta il proprio RBAC di ownership (admin su qualunque allegato, il
 * volontario solo sui propri).
 */
export const updateDeviceRequestAttachmentDescription = onCall({ region: REGION }, async (request) => {
  const invokeId = getInvokeId(request);
  console.log(`[updateDeviceRequestAttachmentDescription] Invoke ID: ${invokeId} - Function called`);

  const uid = request.auth?.uid;
  if (!uid) {
    throw new HttpsError("unauthenticated", "User must be authenticated");
  }

  const { requestId, attachmentId, description, notes } = request.data as {
    requestId?: string;
    attachmentId?: string;
    description?: string;
    notes?: string;
  };

  if (!requestId || typeof requestId !== "string") {
    throw new HttpsError("invalid-argument", "Missing parameter: requestId");
  }
  if (!attachmentId || typeof attachmentId !== "string") {
    throw new HttpsError("invalid-argument", "Missing parameter: attachmentId");
  }

  const db = getFirestore();
  await resolveDeviceRequestAttachment(db, uid, requestId, attachmentId);

  const result = (await updateAttachmentDescription.run({
    ...request,
    data: { attachmentId, description, notes },
  } as CallableRequest)) as { attachmentId: string; description: string; notes: string };

  console.log(
    `[updateDeviceRequestAttachmentDescription] OK: delegated to updateAttachmentDescription for request ${requestId} by ${uid}`
  );
  return result;
});
