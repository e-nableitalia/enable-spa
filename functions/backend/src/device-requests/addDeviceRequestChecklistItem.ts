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
 * Riceve dal consumer `requestId` e `checklistId` (EA-131: `checklistId`
 * esplicito, non più risolto implicitamente): applica il controllo RBAC
 * e la verifica di appartenenza a `checklistIds`
 * (`deviceRequestChecklistAccess.ts`, stesso perimetro di
 * `device/changeStatus.ts`) prima di delegare al core Organizer
 * (`organizer/addChecklistItem.ts`).
 *
 * EA-141/F-26: se `assignee` è presente e non nullo, viene validato con lo
 * stesso controllo di `updateDeviceRequestChecklistItem.ts`
 * (`isResolvableChecklistAssignee`) — deve risolvere a un uid Firebase tra
 * gli `assignedVolunteers` della `deviceRequest` collegata oppure a un
 * utente con ruolo `admin`, altrimenti la richiesta è rifiutata con
 * `invalid-argument`. Prima di questo fix, la creazione di un item era
 * l'unico endpoint del layer che accettava ancora `assignee` come stringa
 * libera non risolta.
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

    const { requestId, checklistId, title, type, assignee, quantity, notes, url } = request.data as {
      requestId?: string;
      checklistId?: string;
      title?: string;
      type?: string;
      assignee?: string | null;
      quantity?: number;
      notes?: string;
      url?: string | null;
    };

    if (!requestId || typeof requestId !== "string") {
      throw new HttpsError("invalid-argument", "Missing parameter: requestId");
    }
    if (!checklistId || typeof checklistId !== "string") {
      throw new HttpsError("invalid-argument", "Missing parameter: checklistId");
    }

    const db = getFirestore();
    await resolveDeviceRequestChecklistAccess(db, uid, requestId, checklistId, { forWrite: true });

    const result = (await addChecklistItem.run({
      ...request,
      data: { checklistId, title, type, assignee, quantity, notes, url },
    } as CallableRequest)) as { itemId: string };

    console.log(
      `[addDeviceRequestChecklistItem] OK: item ${result.itemId} added to checklist ${checklistId} ` +
        `of request ${requestId} by ${uid}`
    );
    return result;
  }
);
