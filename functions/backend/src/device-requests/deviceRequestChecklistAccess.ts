import { HttpsError } from "firebase-functions/v2/https";
import type { Firestore } from "firebase-admin/firestore";

/**
 * Risoluzione di accesso alla checklist operativa collegata a una
 * `deviceRequest`, condivisa da tutte le Cloud Function del layer
 * device-requests che leggono o aggiornano item della checklist
 * (`getDeviceRequestChecklist`, `getDeviceRequestChecklistCompleteness`,
 * `addDeviceRequestChecklistItem`, `updateDeviceRequestChecklistItem`,
 * `removeDeviceRequestChecklistItem`) oltre che da
 * `createChecklistShareLink` (stesso RBAC, non citata negli scenari
 * Gherkin di EA-131 ma soggetta allo stesso cambio di contratto, vedi
 * `docs/FINDINGS.md` F-14).
 *
 * RBAC: stesso perimetro di `device/changeStatus.ts` — admin su
 * qualsiasi richiesta, volontario solo se presente in
 * `assignedVolunteers` della `deviceRequest`. Il core Organizer non
 * conosce il concetto di deviceRequest (vedi `organizer/getChecklist.ts`
 * e affini): questo layer applica il controllo di ruolo/assegnazione
 * prima di delegare al core.
 *
 * `checklistId` (EA-131, Epic EA-129): il chiamante lo passa in modo
 * esplicito — non viene più risolto implicitamente da un unico campo
 * singolare, perché una `deviceRequest` può avere più checklist
 * collegate (`checklistIds: string[]`, EA-130). Questa funzione verifica
 * solo che il `checklistId` passato appartenga effettivamente alla
 * richiesta, con `not-found` altrimenti.
 *
 * Coesistenza dati legacy: se la richiesta non ha ancora `checklistIds`
 * (creata prima dell'Epic EA-129) ma ha il vecchio campo singolare
 * `checklistId`, un chiamante che passa esplicitamente proprio quel
 * valore viene risolto come se fosse presente in `checklistIds` — nessun
 * backfill è necessario, la coesistenza è gestita qui a runtime.
 */
export async function resolveDeviceRequestChecklistAccess(
  db: Firestore,
  uid: string,
  requestId: string,
  checklistId: string
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

  const checklistIds: unknown[] = Array.isArray(requestData.checklistIds)
    ? requestData.checklistIds
    : [];
  const legacyChecklistId =
    typeof requestData.checklistId === "string" ? requestData.checklistId : undefined;

  const belongsToRequest = checklistIds.includes(checklistId) || legacyChecklistId === checklistId;

  if (!belongsToRequest) {
    throw new HttpsError("not-found", "Checklist not linked to this device request");
  }

  return { checklistId };
}
