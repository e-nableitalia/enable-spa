import { onCall, HttpsError } from "firebase-functions/v2/https";
import type { CallableRequest } from "firebase-functions/v2/https";
import { getFirestore } from "firebase-admin/firestore";
import { getInvokeId } from "../utils/invoke";
import { getChecklist } from "../organizer/getChecklist";
import { resolveDeviceRequestChecklistAccess } from "./deviceRequestChecklistAccess";

const REGION = "europe-west1";

/**
 * Cloud Function callable del layer di integrazione device-requests:
 * legge la checklist di fabbricazione collegata a una `deviceRequest`.
 *
 * Riceve dal consumer `requestId` (non `checklistId`): questo layer
 * risolve il `checklistId` collegato alla richiesta e applica il
 * controllo RBAC (`deviceRequestChecklistAccess.ts`, stesso perimetro di
 * `device/changeStatus.ts`) prima di delegare al core Organizer
 * (`organizer/getChecklist.ts`).
 */
export const getDeviceRequestChecklist = onCall(
  { region: REGION },
  async (request) => {
    const invokeId = getInvokeId(request);
    console.log(`[getDeviceRequestChecklist] Invoke ID: ${invokeId} - Function called`);

    const uid = request.auth?.uid;
    if (!uid) {
      throw new HttpsError("unauthenticated", "User must be authenticated");
    }

    const { requestId } = request.data as { requestId?: string };
    if (!requestId || typeof requestId !== "string") {
      throw new HttpsError("invalid-argument", "Missing parameter: requestId");
    }

    const db = getFirestore();
    const { checklistId } = await resolveDeviceRequestChecklistAccess(db, uid, requestId);

    const result = (await getChecklist.run({
      ...request,
      data: { checklistId },
    } as CallableRequest)) as unknown as Record<string, unknown>;

    console.log(`[getDeviceRequestChecklist] OK: checklist ${checklistId} of request ${requestId} read by ${uid}`);
    return { checklistId, ...result };
  }
);
