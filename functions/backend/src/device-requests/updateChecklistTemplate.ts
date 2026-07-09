import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getInvokeId } from "../utils/invoke";
import { requireAdminRole } from "../utils/roles";
import { updateTemplate } from "../organizer/updateTemplate";

const REGION = "europe-west1";

/**
 * Cloud Function callable del layer di integrazione device-requests:
 * aggiorna un template di checklist esistente nel catalogo Organizer,
 * riservato agli admin.
 *
 * Il core Organizer (`organizer/updateTemplate.ts`) verifica solo
 * l'autenticazione (`request.auth`), nessun controllo di ruolo. Questo
 * layer introduce il controllo `role === 'admin'` (stesso pattern di
 * `device/assignVolunteer.ts`: lettura di `users/{uid}.role` da
 * Firestore) prima di invocare la funzione di scrittura del core.
 */
export const updateDeviceChecklistTemplate = onCall(
  { region: REGION },
  async (request) => {
    const invokeId = getInvokeId(request);
    console.log(`[updateDeviceChecklistTemplate] Invoke ID: ${invokeId} - Function called`);

    const authUid = request.auth?.uid;
    if (!authUid) {
      console.log("[updateDeviceChecklistTemplate] KO: Unauthenticated");
      throw new HttpsError("unauthenticated", "Authentication required");
    }

    await requireAdminRole(authUid, "[updateDeviceChecklistTemplate]");

    console.log(`[updateDeviceChecklistTemplate] Delegating to core updateTemplate for uid ${authUid}`);
    return updateTemplate.run(request);
  }
);
