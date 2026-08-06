import { onCall, HttpsError } from "firebase-functions/v2/https";
import type { CallableRequest } from "firebase-functions/v2/https";
import { getFirestore } from "firebase-admin/firestore";
import { getInvokeId } from "../utils/invoke";
import { updateChecklistItem } from "../organizer/updateChecklistItem";
import { resolveDeviceRequestChecklistAccess, isResolvableChecklistAssignee } from "./deviceRequestChecklistAccess";

const REGION = "europe-west1";

/**
 * Cloud Function callable del layer di integrazione device-requests:
 * aggiorna in modo parziale un item (titolo, stato, assegnatario,
 * quantità, note, completed) della checklist di fabbricazione collegata a
 * una `deviceRequest`.
 *
 * Riceve dal consumer `requestId` e `checklistId` (EA-131: `checklistId`
 * esplicito, non più risolto implicitamente): applica il controllo RBAC
 * e la verifica di appartenenza a `checklistIds`
 * (`deviceRequestChecklistAccess.ts`, stesso perimetro di
 * `device/changeStatus.ts`) prima di delegare al core Organizer
 * (`organizer/updateChecklistItem.ts`).
 *
 * EA-141: se `assignee` è presente e non nullo, viene promosso da stringa
 * libera a identità reale — deve risolvere a un uid Firebase tra i
 * `assignedVolunteers` della `deviceRequest` collegata oppure a un utente
 * con ruolo `admin` (`isResolvableChecklistAssignee`), altrimenti la
 * richiesta è rifiutata con `invalid-argument`. Il core Organizer riceve
 * solo un `assignee` già validato e resta opaco al concetto di identità.
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

    const { requestId, checklistId, itemId, title, type, status, assignee, quantity, notes, completed } = request.data as {
      requestId?: string;
      checklistId?: string;
      itemId?: string;
      title?: string;
      type?: string;
      status?: string;
      assignee?: string | null;
      quantity?: number | null;
      notes?: string | null;
      completed?: boolean;
    };

    if (!requestId || typeof requestId !== "string") {
      throw new HttpsError("invalid-argument", "Missing parameter: requestId");
    }
    if (!checklistId || typeof checklistId !== "string") {
      throw new HttpsError("invalid-argument", "Missing parameter: checklistId");
    }

    const db = getFirestore();
    const { assignedVolunteers } = await resolveDeviceRequestChecklistAccess(db, uid, requestId, checklistId);

    if (assignee !== undefined && assignee !== null) {
      if (typeof assignee !== "string" || !(await isResolvableChecklistAssignee(db, assignee, assignedVolunteers))) {
        throw new HttpsError(
          "invalid-argument",
          "Assignee must be a Firebase uid of a volunteer assigned to this request or an admin"
        );
      }
    }

    const result = (await updateChecklistItem.run({
      ...request,
      data: { checklistId, itemId, title, type, status, assignee, quantity, notes, completed },
    } as CallableRequest)) as { success: boolean };

    console.log(
      `[updateDeviceRequestChecklistItem] OK: item ${itemId} of checklist ${checklistId} ` +
        `of request ${requestId} updated by ${uid}`
    );
    return result;
  }
);
