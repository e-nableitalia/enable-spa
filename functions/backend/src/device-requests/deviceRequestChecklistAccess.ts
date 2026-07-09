import { HttpsError } from "firebase-functions/v2/https";
import type { Firestore } from "firebase-admin/firestore";

/**
 * Risoluzione di accesso alla checklist operativa collegata a una
 * `deviceRequest`, condivisa da tutte le Cloud Function del layer
 * device-requests che leggono o aggiornano item della checklist
 * (`getDeviceRequestChecklist`, `getDeviceRequestChecklistCompleteness`,
 * `addDeviceRequestChecklistItem`, `updateDeviceRequestChecklistItem`,
 * `removeDeviceRequestChecklistItem`).
 *
 * RBAC: stesso perimetro di `device/changeStatus.ts` — admin su
 * qualsiasi richiesta, volontario solo se presente in
 * `assignedVolunteers` della `deviceRequest`. Il core Organizer non
 * conosce il concetto di deviceRequest (vedi `organizer/getChecklist.ts`
 * e affini): questo layer risolve `requestId` -> `checklistId` e applica
 * il controllo di ruolo/assegnazione prima di delegare al core.
 */
export async function resolveDeviceRequestChecklistAccess(
  db: Firestore,
  uid: string,
  requestId: string
): Promise<{ checklistId: string }> {
  const requestRef = db.collection("deviceRequests").doc(requestId);
  const requestSnap = await requestRef.get();

  if (!requestSnap.exists) {
    throw new HttpsError("not-found", "Device request not found");
  }

  const requestData = requestSnap.data() ?? {};

  const userSnap = await db.collection("users").doc(uid).get();
  const role = userSnap.exists ? userSnap.data()?.role : undefined;

  const isAdmin = role === "admin";
  const isAssignedVolunteer =
    role === "volunteer" &&
    Array.isArray(requestData.assignedVolunteers) &&
    requestData.assignedVolunteers.includes(uid);

  if (!isAdmin && !isAssignedVolunteer) {
    throw new HttpsError(
      "permission-denied",
      "Only admin or assigned volunteers can access the checklist for this request"
    );
  }

  const checklistId = requestData.checklistId;
  if (!checklistId || typeof checklistId !== "string") {
    throw new HttpsError("not-found", "No checklist linked to this device request");
  }

  return { checklistId };
}
