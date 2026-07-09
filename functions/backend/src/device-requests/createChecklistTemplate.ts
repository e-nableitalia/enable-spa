import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getInvokeId } from "../utils/invoke";
import { requireAdminRole } from "../utils/roles";
import { createTemplate } from "../organizer/createTemplate";

const REGION = "europe-west1";

/**
 * Cloud Function callable del layer di integrazione device-requests:
 * crea un template di checklist nel catalogo Organizer riservato agli
 * admin.
 *
 * Il core Organizer (`organizer/createTemplate.ts`) verifica solo
 * l'autenticazione (`request.auth`), nessun controllo di ruolo. Questo
 * layer introduce il controllo `role === 'admin'` (stesso pattern di
 * `device/assignVolunteer.ts`: lettura di `users/{uid}.role` da
 * Firestore) prima di invocare la funzione di scrittura del core.
 *
 * `category` corrisponde al `devicetype` della deviceRequest (es.
 * "Kinetic Hand", "Kinetic Arm", ... oppure testo libero per "Altro"): un
 * valore opaco per il core Organizer.
 */
export const createDeviceChecklistTemplate = onCall(
  { region: REGION },
  async (request) => {
    const invokeId = getInvokeId(request);
    console.log(`[createDeviceChecklistTemplate] Invoke ID: ${invokeId} - Function called`);

    const authUid = request.auth?.uid;
    if (!authUid) {
      console.log("[createDeviceChecklistTemplate] KO: Unauthenticated");
      throw new HttpsError("unauthenticated", "Authentication required");
    }

    await requireAdminRole(authUid, "[createDeviceChecklistTemplate]");

    console.log(`[createDeviceChecklistTemplate] Delegating to core createTemplate for uid ${authUid}`);
    return createTemplate.run(request);
  }
);
