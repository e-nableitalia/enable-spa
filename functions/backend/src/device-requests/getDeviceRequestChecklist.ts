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
 * Riceve dal consumer `requestId` e `checklistId` (EA-131: `checklistId`
 * esplicito, non più risolto implicitamente): applica il controllo RBAC
 * e la verifica di appartenenza a `checklistIds`
 * (`deviceRequestChecklistAccess.ts`, stesso perimetro di
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

    const { requestId, checklistId } = request.data as { requestId?: string; checklistId?: string };
    if (!requestId || typeof requestId !== "string") {
      throw new HttpsError("invalid-argument", "Missing parameter: requestId");
    }
    if (!checklistId || typeof checklistId !== "string") {
      throw new HttpsError("invalid-argument", "Missing parameter: checklistId");
    }

    const db = getFirestore();
    await resolveDeviceRequestChecklistAccess(db, uid, requestId, checklistId);

    const result = (await getChecklist.run({
      ...request,
      data: { checklistId },
    } as CallableRequest)) as unknown as Record<string, unknown>;

    console.log(`[getDeviceRequestChecklist] OK: checklist ${checklistId} of request ${requestId} read by ${uid}`);
    return { checklistId, ...result };
  }
);
