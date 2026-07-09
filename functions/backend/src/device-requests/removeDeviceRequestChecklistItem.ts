import { onCall, HttpsError } from "firebase-functions/v2/https";
import type { CallableRequest } from "firebase-functions/v2/https";
import { getFirestore } from "firebase-admin/firestore";
import { getInvokeId } from "../utils/invoke";
import { removeChecklistItem } from "../organizer/removeChecklistItem";
import { resolveDeviceRequestChecklistAccess } from "./deviceRequestChecklistAccess";

const REGION = "europe-west1";

/**
 * Cloud Function callable del layer di integrazione device-requests:
 * rimuove un item dalla checklist di fabbricazione collegata a una
 * `deviceRequest`.
 *
 * Riceve dal consumer `requestId` (non `checklistId`): questo layer
 * risolve il `checklistId` collegato alla richiesta e applica il
 * controllo RBAC (`deviceRequestChecklistAccess.ts`, stesso perimetro di
 * `device/changeStatus.ts`) prima di delegare al core Organizer
 * (`organizer/removeChecklistItem.ts`).
 */
export const removeDeviceRequestChecklistItem = onCall(
  { region: REGION },
  async (request) => {
    const invokeId = getInvokeId(request);
    console.log(`[removeDeviceRequestChecklistItem] Invoke ID: ${invokeId} - Function called`);

    const uid = request.auth?.uid;
    if (!uid) {
      throw new HttpsError("unauthenticated", "User must be authenticated");
    }

    const { requestId, itemId } = request.data as {
      requestId?: string;
      itemId?: string;
    };

    if (!requestId || typeof requestId !== "string") {
      throw new HttpsError("invalid-argument", "Missing parameter: requestId");
    }

    const db = getFirestore();
    const { checklistId } = await resolveDeviceRequestChecklistAccess(db, uid, requestId);

    const result = (await removeChecklistItem.run({
      ...request,
      data: { checklistId, itemId },
    } as CallableRequest)) as { success: boolean };

    console.log(
      `[removeDeviceRequestChecklistItem] OK: item ${itemId} removed from checklist ${checklistId} ` +
        `of request ${requestId} by ${uid}`
    );
    return result;
  }
);
