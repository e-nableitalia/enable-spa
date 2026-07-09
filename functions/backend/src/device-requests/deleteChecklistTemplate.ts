import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getInvokeId } from "../utils/invoke";
import { requireAdminRole } from "../utils/roles";
import { deleteTemplate } from "../organizer/deleteTemplate";

const REGION = "europe-west1";

/**
 * Cloud Function callable del layer di integrazione device-requests:
 * elimina un template di checklist esistente nel catalogo Organizer,
 * riservato agli admin.
 *
 * Il core Organizer (`organizer/deleteTemplate.ts`) verifica solo
 * l'autenticazione (`request.auth`), nessun controllo di ruolo. Questo
 * layer introduce il controllo `role === 'admin'` (stesso pattern di
 * `device/assignVolunteer.ts`: lettura di `users/{uid}.role` da
 * Firestore) prima di invocare la funzione di scrittura del core.
 */
export const deleteDeviceChecklistTemplate = onCall(
  { region: REGION },
  async (request) => {
    const invokeId = getInvokeId(request);
    console.log(`[deleteDeviceChecklistTemplate] Invoke ID: ${invokeId} - Function called`);

    const authUid = request.auth?.uid;
    if (!authUid) {
      console.log("[deleteDeviceChecklistTemplate] KO: Unauthenticated");
      throw new HttpsError("unauthenticated", "Authentication required");
    }

    await requireAdminRole(authUid, "[deleteDeviceChecklistTemplate]");

    console.log(`[deleteDeviceChecklistTemplate] Delegating to core deleteTemplate for uid ${authUid}`);
    return deleteTemplate.run(request);
  }
);
