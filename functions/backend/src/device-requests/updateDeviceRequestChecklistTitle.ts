import { onCall, HttpsError } from "firebase-functions/v2/https";
import type { CallableRequest } from "firebase-functions/v2/https";
import { getFirestore } from "firebase-admin/firestore";
import { getInvokeId } from "../utils/invoke";
import { updateChecklist } from "../organizer/updateChecklist";
import { resolveDeviceRequestChecklistAccess } from "./deviceRequestChecklistAccess";

const REGION = "europe-west1";

/**
 * Aggiorna il titolo di una checklist collegata a una deviceRequest,
 * mantenendo lo stesso perimetro RBAC del dominio device-requests.
 */
export const updateDeviceRequestChecklistTitle = onCall({ region: REGION }, async (request) => {
  const invokeId = getInvokeId(request);
  console.log(`[updateDeviceRequestChecklistTitle] Invoke ID: ${invokeId} - Function called`);

  const uid = request.auth?.uid;
  if (!uid) {
    throw new HttpsError("unauthenticated", "User must be authenticated");
  }

  const { requestId, checklistId, title } = (request.data ?? {}) as {
    requestId?: string;
    checklistId?: string;
    title?: string;
  };

  if (!requestId || typeof requestId !== "string") {
    throw new HttpsError("invalid-argument", "Missing parameter: requestId");
  }
  if (!checklistId || typeof checklistId !== "string") {
    throw new HttpsError("invalid-argument", "Missing parameter: checklistId");
  }
  if (!title || typeof title !== "string" || !title.trim()) {
    throw new HttpsError("invalid-argument", "Missing or invalid title");
  }

  const db = getFirestore();
  await resolveDeviceRequestChecklistAccess(db, uid, requestId, checklistId, { forWrite: true });

  const result = (await updateChecklist.run({
    ...request,
    data: { checklistId, title: title.trim() },
  } as CallableRequest)) as { checklistId: string; title: string };

  console.log(
    `[updateDeviceRequestChecklistTitle] OK: checklist ${checklistId} of request ${requestId} updated by ${uid}`
  );
  return result;
});
