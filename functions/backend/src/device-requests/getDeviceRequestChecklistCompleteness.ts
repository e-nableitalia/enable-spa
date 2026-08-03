import { onCall, HttpsError } from "firebase-functions/v2/https";
import type { CallableRequest } from "firebase-functions/v2/https";
import { getFirestore } from "firebase-admin/firestore";
import { getInvokeId } from "../utils/invoke";
import { getChecklistCompleteness } from "../organizer/getChecklistCompleteness";
import { resolveDeviceRequestChecklistAccess } from "./deviceRequestChecklistAccess";

const REGION = "europe-west1";

/**
 * Cloud Function callable del layer di integrazione device-requests:
 * espone l'indicatore di completezza (gate di completezza, Epic EA-3)
 * della checklist di fabbricazione collegata a una `deviceRequest`.
 *
 * Riceve dal consumer `requestId` e `checklistId` (EA-131: `checklistId`
 * esplicito, non più risolto implicitamente): applica il controllo RBAC
 * e la verifica di appartenenza a `checklistIds`
 * (`deviceRequestChecklistAccess.ts`, stesso perimetro di
 * `device/changeStatus.ts`) prima di delegare al core Organizer
 * (`organizer/getChecklistCompleteness.ts`).
 */
export const getDeviceRequestChecklistCompleteness = onCall(
  { region: REGION },
  async (request) => {
    const invokeId = getInvokeId(request);
    console.log(`[getDeviceRequestChecklistCompleteness] Invoke ID: ${invokeId} - Function called`);

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

    const result = (await getChecklistCompleteness.run({
      ...request,
      data: { checklistId },
    } as CallableRequest)) as { complete: boolean };

    console.log(
      `[getDeviceRequestChecklistCompleteness] OK: checklist ${checklistId} of request ${requestId} ` +
        `complete=${result.complete} read by ${uid}`
    );
    return { checklistId, complete: result.complete };
  }
);
