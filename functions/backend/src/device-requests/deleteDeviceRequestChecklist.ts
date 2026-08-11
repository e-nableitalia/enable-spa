import { onCall, HttpsError } from "firebase-functions/v2/https";
import type { CallableRequest } from "firebase-functions/v2/https";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { getInvokeId } from "../utils/invoke";
import { deleteChecklist } from "../organizer/deleteChecklist";

const REGION = "europe-west1";

/**
 * Cloud Function callable del layer di integrazione device-requests:
 * elimina una checklist di fabbricazione collegata a una `deviceRequest` e
 * rimuove il riferimento da `deviceRequests/{requestId}.checklistIds`
 * (bug segnalato dall'operatore: senza questo passaggio, la tab della
 * checklist eliminata resterebbe agganciata alla richiesta, orfana).
 *
 * Delega la cancellazione vera e propria al core Organizer
 * (`organizer/deleteChecklist.ts`), che elimina anche ogni documento
 * `checklistItems` collegato (query su `checklistId`, con chunking oltre
 * il limite di 500 operazioni per batch) — nessun item orfano.
 *
 * RBAC: solo admin (a differenza di create/clone, non estesa ai volontari
 * assegnati — perimetro esplicitamente richiesto dall'operatore per questa
 * azione distruttiva).
 */
export const deleteDeviceRequestChecklist = onCall(
  { region: REGION },
  async (request) => {
    const invokeId = getInvokeId(request);
    console.log(`[deleteDeviceRequestChecklist] Invoke ID: ${invokeId} - Function called`);

    const authUid = request.auth?.uid;
    if (!authUid) {
      console.log("[deleteDeviceRequestChecklist] KO: Unauthenticated");
      throw new HttpsError("unauthenticated", "Authentication required");
    }

    const data = request.data ?? {};
    const { requestId, checklistId } = data;

    if (!requestId || typeof requestId !== "string") {
      console.log("[deleteDeviceRequestChecklist] KO: Missing or invalid requestId");
      throw new HttpsError("invalid-argument", "Missing or invalid requestId");
    }

    if (!checklistId || typeof checklistId !== "string") {
      console.log("[deleteDeviceRequestChecklist] KO: Missing or invalid checklistId");
      throw new HttpsError("invalid-argument", "Missing or invalid checklistId");
    }

    const db = getFirestore();

    const userSnap = await db.collection("users").doc(authUid).get();
    const role = userSnap.exists ? userSnap.data()?.role : undefined;

    if (role !== "admin") {
      console.log(`[deleteDeviceRequestChecklist] KO: Permission denied for uid ${authUid}`);
      throw new HttpsError(
        "permission-denied",
        "Only admin can delete a checklist for a device request"
      );
    }

    const requestRef = db.collection("deviceRequests").doc(requestId);
    const requestSnap = await requestRef.get();

    if (!requestSnap.exists) {
      console.log(`[deleteDeviceRequestChecklist] KO: request ${requestId} not found`);
      throw new HttpsError("not-found", "Device request not found");
    }

    const requestData = requestSnap.data() ?? {};
    const existingChecklistIds: unknown[] = Array.isArray(requestData.checklistIds)
      ? requestData.checklistIds
      : [];

    if (!existingChecklistIds.includes(checklistId)) {
      console.log(
        `[deleteDeviceRequestChecklist] KO: checklist ${checklistId} is not linked to request ${requestId}`
      );
      throw new HttpsError(
        "failed-precondition",
        "The checklist is not linked to this device request"
      );
    }

    await deleteChecklist.run({
      ...request,
      data: { checklistId },
    } as CallableRequest);

    await requestRef.update({
      checklistIds: FieldValue.arrayRemove(checklistId),
      updatedAt: FieldValue.serverTimestamp(),
    });

    console.log(
      `[deleteDeviceRequestChecklist] OK: checklist ${checklistId} deleted and unlinked from request ${requestId} by ${authUid}`
    );

    return { success: true };
  }
);
