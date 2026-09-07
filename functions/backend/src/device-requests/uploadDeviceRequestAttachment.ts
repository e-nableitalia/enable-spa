import { onCall, HttpsError } from "firebase-functions/v2/https";
import type { CallableRequest } from "firebase-functions/v2/https";
import { getFirestore } from "firebase-admin/firestore";
import { getInvokeId } from "../utils/invoke";
import { uploadAttachment } from "../attachments/uploadAttachment";
import { resolveDeviceRequestAttachmentAccess } from "./deviceRequestAttachmentAccess";

const REGION = "europe-west1";

/**
 * Cloud Function callable del layer di integrazione device-requests
 * (EA-168): carica un allegato collegato a una `deviceRequest`.
 *
 * Applica il controllo RBAC più stretto di device-requests (admin, o
 * volontario assegnato alla richiesta — `resolveDeviceRequestAttachmentAccess`)
 * prima di delegare alla Cloud Function generica della capability di base
 * `uploadAttachment` (stesso pattern di `addDeviceRequestChecklistItem`
 * verso `addChecklistItem`), passando `entityType`/`entityId`/
 * `entityCollectionPath` fissi per il dominio device-requests — il
 * chiamante non li fornisce mai direttamente.
 */
export const uploadDeviceRequestAttachment = onCall({ region: REGION }, async (request) => {
  const invokeId = getInvokeId(request);
  console.log(`[uploadDeviceRequestAttachment] Invoke ID: ${invokeId} - Function called`);

  const uid = request.auth?.uid;
  if (!uid) {
    throw new HttpsError("unauthenticated", "User must be authenticated");
  }

  const { requestId, fileName, description, notes, category, size } = request.data as {
    requestId?: string;
    fileName?: string;
    description?: string;
    notes?: string;
    category?: string;
    size?: number;
  };

  if (!requestId || typeof requestId !== "string") {
    throw new HttpsError("invalid-argument", "Missing parameter: requestId");
  }

  const db = getFirestore();
  await resolveDeviceRequestAttachmentAccess(db, uid, requestId);

  const result = (await uploadAttachment.run({
    ...request,
    data: {
      entityType: "deviceRequest",
      entityId: requestId,
      entityCollectionPath: "deviceRequests",
      fileName,
      description,
      notes,
      category,
      size,
    },
  } as CallableRequest)) as { attachmentId: string; uploadUrl: string; storagePath: string };

  console.log(
    `[uploadDeviceRequestAttachment] OK: delegated to uploadAttachment for request ${requestId} by ${uid}`
  );
  return result;
});
