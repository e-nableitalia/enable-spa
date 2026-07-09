import { onCall, HttpsError } from "firebase-functions/v2/https";
import type { CallableRequest } from "firebase-functions/v2/https";
import { getFirestore } from "firebase-admin/firestore";
import { getInvokeId } from "../utils/invoke";
import { addChecklistItem } from "../organizer/addChecklistItem";
import { resolveDeviceRequestChecklistAccess } from "./deviceRequestChecklistAccess";

const REGION = "europe-west1";

/**
 * Cloud Function callable del layer di integrazione device-requests:
 * aggiunge un item alla checklist di fabbricazione collegata a una
 * `deviceRequest`.
 *
 * Riceve dal consumer `requestId` (non `checklistId`): questo layer
 * risolve il `checklistId` collegato alla richiesta e applica il
 * controllo RBAC (`deviceRequestChecklistAccess.ts`, stesso perimetro di
 * `device/changeStatus.ts`) prima di delegare al core Organizer
 * (`organizer/addChecklistItem.ts`).
 */
export const addDeviceRequestChecklistItem = onCall(
  { region: REGION },
  async (request) => {
    const invokeId = getInvokeId(request);
    console.log(`[addDeviceRequestChecklistItem] Invoke ID: ${invokeId} - Function called`);

    const uid = request.auth?.uid;
    if (!uid) {
      throw new HttpsError("unauthenticated", "User must be authenticated");
    }

    const { requestId, title, assignee, quantity, notes } = request.data as {
      requestId?: string;
      title?: string;
      assignee?: string;
      quantity?: number;
      notes?: string;
    };

    if (!requestId || typeof requestId !== "string") {
      throw new HttpsError("invalid-argument", "Missing parameter: requestId");
    }

    const db = getFirestore();
    const { checklistId } = await resolveDeviceRequestChecklistAccess(db, uid, requestId);

    const result = (await addChecklistItem.run({
      ...request,
      data: { checklistId, title, assignee, quantity, notes },
    } as CallableRequest)) as { itemId: string };

    console.log(
      `[addDeviceRequestChecklistItem] OK: item ${result.itemId} added to checklist ${checklistId} ` +
        `of request ${requestId} by ${uid}`
    );
    return result;
  }
);
