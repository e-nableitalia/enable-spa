import { HttpsError } from "firebase-functions/v2/https";
import type { Firestore } from "firebase-admin/firestore";

/**
 * Risoluzione di accesso alla checklist operativa collegata a una
 * `deviceRequest`, condivisa da tutte le Cloud Function del layer
 * device-requests che leggono o aggiornano item della checklist
 * (`getDeviceRequestChecklist`, `getDeviceRequestChecklistCompleteness`,
 * `addDeviceRequestChecklistItem`, `updateDeviceRequestChecklistItem`,
 * `removeDeviceRequestChecklistItem`) oltre che da
 * `createChecklistShareLink` (stesso RBAC; il cambio di contratto era
 * gia' stato esteso qui in via preventiva da EA-131 per non rompere la
 * build, vedi `docs/FINDINGS.md` F-15 — EA-132 formalizza a livello di
 * Story/scenari Gherkin questo stesso comportamento gia' in vigore).
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
 * Nessuna coesistenza con il vecchio campo singolare `checklistId`:
 * confermato (EA-133) che non esistono dati reali dietro quel campo, solo
 * documenti di test bonificati su staging — nessun dual-read voluto,
 * vedi `docs/FINDINGS.md` F-14.
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

  if (!checklistIds.includes(checklistId)) {
    throw new HttpsError("not-found", "Checklist not linked to this device request");
  }

  return { checklistId };
}
