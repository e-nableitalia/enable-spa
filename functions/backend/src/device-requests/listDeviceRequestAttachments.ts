import { onCall, HttpsError } from "firebase-functions/v2/https";
import type { CallableRequest } from "firebase-functions/v2/https";
import { getFirestore } from "firebase-admin/firestore";
import { getInvokeId } from "../utils/invoke";
import { listAttachments } from "../attachments/listAttachments";
import { resolveDeviceRequestAttachmentAccess } from "./deviceRequestAttachmentAccess";

const REGION = "europe-west1";

/**
 * Cloud Function callable del layer di integrazione device-requests
 * (EA-168): elenca gli allegati collegati a una `deviceRequest`.
 *
 * Applica il controllo RBAC più stretto di device-requests prima di
 * delegare alla Cloud Function generica `listAttachments`. Il filtro per
 * categoria (decisione operatore) è client-side sul risultato: la
 * funzione generica restituisce già `category` per ogni allegato.
 */
export const listDeviceRequestAttachments = onCall({ region: REGION }, async (request) => {
  const invokeId = getInvokeId(request);
  console.log(`[listDeviceRequestAttachments] Invoke ID: ${invokeId} - Function called`);

  const uid = request.auth?.uid;
  if (!uid) {
    throw new HttpsError("unauthenticated", "User must be authenticated");
  }

  const { requestId } = request.data as { requestId?: string };

  if (!requestId || typeof requestId !== "string") {
    throw new HttpsError("invalid-argument", "Missing parameter: requestId");
  }

  const db = getFirestore();
  await resolveDeviceRequestAttachmentAccess(db, uid, requestId);

  const result = (await listAttachments.run({
    ...request,
    data: {
      entityType: "deviceRequest",
      entityId: requestId,
      entityCollectionPath: "deviceRequests",
    },
  } as CallableRequest)) as { attachments: unknown[] };

  console.log(
    `[listDeviceRequestAttachments] OK: delegated to listAttachments for request ${requestId} by ${uid}`
  );
  return result;
});
