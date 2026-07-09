import { onCall, HttpsError } from "firebase-functions/v2/https";
import type { CallableRequest } from "firebase-functions/v2/https";
import { getFirestore } from "firebase-admin/firestore";
import { getInvokeId } from "../utils/invoke";
import { updateChecklistItem } from "../organizer/updateChecklistItem";
import { resolveDeviceRequestChecklistAccess } from "./deviceRequestChecklistAccess";

const REGION = "europe-west1";

/**
 * Cloud Function callable del layer di integrazione device-requests:
 * aggiorna in modo parziale un item (titolo, stato, assegnatario,
 * quantità, note) della checklist di fabbricazione collegata a una
 * `deviceRequest`.
 *
 * Riceve dal consumer `requestId` (non `checklistId`): questo layer
 * risolve il `checklistId` collegato alla richiesta e applica il
 * controllo RBAC (`deviceRequestChecklistAccess.ts`, stesso perimetro di
 * `device/changeStatus.ts`) prima di delegare al core Organizer
 * (`organizer/updateChecklistItem.ts`).
 */
export const updateDeviceRequestChecklistItem = onCall(
  { region: REGION },
  async (request) => {
    const invokeId = getInvokeId(request);
    console.log(`[updateDeviceRequestChecklistItem] Invoke ID: ${invokeId} - Function called`);

    const uid = request.auth?.uid;
    if (!uid) {
      throw new HttpsError("unauthenticated", "User must be authenticated");
    }

    const { requestId, itemId, title, status, assignee, quantity, notes } = request.data as {
      requestId?: string;
      itemId?: string;
      title?: string;
      status?: string;
      assignee?: string | null;
      quantity?: number | null;
      notes?: string | null;
    };

    if (!requestId || typeof requestId !== "string") {
      throw new HttpsError("invalid-argument", "Missing parameter: requestId");
    }

    const db = getFirestore();
    const { checklistId } = await resolveDeviceRequestChecklistAccess(db, uid, requestId);

    const result = (await updateChecklistItem.run({
      ...request,
      data: { checklistId, itemId, title, status, assignee, quantity, notes },
    } as CallableRequest)) as { success: boolean };

    console.log(
      `[updateDeviceRequestChecklistItem] OK: item ${itemId} of checklist ${checklistId} ` +
        `of request ${requestId} updated by ${uid}`
    );
    return result;
  }
);
