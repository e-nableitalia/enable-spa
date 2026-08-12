import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore } from "firebase-admin/firestore";
import { getInvokeId } from "../utils/invoke";

const REGION = "europe-west1";

/**
 * Cloud Function callable del layer di integrazione device-requests
 * (F-27): risolve lato server l'elenco completo di utenti selezionabili
 * come assegnatario di un item di checklist per una `deviceRequest` —
 * `assignedVolunteers` della richiesta più **tutti** gli admin
 * dell'organizzazione, non solo il chiamante.
 *
 * Prima di questa funzione, `ChecklistPanel.tsx` risolveva questo elenco
 * client-side leggendo `deviceRequests/{id}` (per `assignedVolunteers`,
 * leggibile da qualunque volontario/admin autenticato) più il proprio
 * documento `users/{selfUid}` per sapere se il chiamante stesso è admin:
 * le regole Firestore (`firestore.rules`, `match /users/{userId}`)
 * permettono infatti a un volontario di leggere solo il proprio
 * documento, mai quello di un altro utente — quindi un admin non poteva
 * mai apparire tra le opzioni a meno di essere il chiamante stesso.
 *
 * RBAC: stesso perimetro di lettura di `resolveDeviceRequestChecklistAccess`
 * (admin o volontario assegnato alla richiesta) — chi può vedere/editare
 * la checklist può anche vedere chi è assegnabile.
 */
export const listAssignableChecklistUsers = onCall(
  { region: REGION },
  async (request) => {
    const invokeId = getInvokeId(request);
    console.log(`[listAssignableChecklistUsers] Invoke ID: ${invokeId} - Function called`);

    const uid = request.auth?.uid;
    if (!uid) {
      throw new HttpsError("unauthenticated", "User must be authenticated");
    }

    const { requestId } = (request.data ?? {}) as { requestId?: string };
    if (!requestId || typeof requestId !== "string") {
      throw new HttpsError("invalid-argument", "Missing parameter: requestId");
    }

    const db = getFirestore();

    const requestSnap = await db.collection("deviceRequests").doc(requestId).get();
    if (!requestSnap.exists) {
      throw new HttpsError("not-found", "Device request not found");
    }

    const requestData = requestSnap.data() ?? {};
    const assignedVolunteers: string[] = Array.isArray(requestData.assignedVolunteers)
      ? requestData.assignedVolunteers
      : [];

    const userSnap = await db.collection("users").doc(uid).get();
    const role = userSnap.exists ? userSnap.data()?.role : undefined;
    const isAdmin = role === "admin";
    const isAssignedVolunteer = role === "volunteer" && assignedVolunteers.includes(uid);

    if (!isAdmin && !isAssignedVolunteer) {
      console.log(`[listAssignableChecklistUsers] KO: Permission denied for uid ${uid}`);
      throw new HttpsError(
        "permission-denied",
        "Only admin or assigned volunteers can list assignable users for this request"
      );
    }

    const adminsSnap = await db.collection("users").where("role", "==", "admin").get();
    const adminUids = adminsSnap.docs.map((doc) => doc.id);

    const uids = Array.from(new Set([...assignedVolunteers, ...adminUids]));

    console.log(`[listAssignableChecklistUsers] OK: ${uids.length} assignable user(s) for request ${requestId}`);
    return { uids };
  }
);
