import { onCall, HttpsError } from "firebase-functions/v2/https";
import type { CallableRequest } from "firebase-functions/v2/https";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { getInvokeId } from "../utils/invoke";
import { cloneChecklist } from "../organizer/cloneChecklist";

const REGION = "europe-west1";

/**
 * Numero massimo di checklist collegabili alla stessa `deviceRequest`
 * (campo array `checklistIds`), stesso limite applicato in
 * `createDeviceRequestChecklist.ts` — valore proposto in EA-130, da
 * confermare o modificare dall'umano.
 */
const MAX_CHECKLISTS_PER_REQUEST = 5;

/**
 * Cloud Function callable del layer di integrazione device-requests: popola
 * la checklist di una `deviceRequest` clonando quella di un'altra
 * `deviceRequest` sorgente (`organizer/cloneChecklist.ts`), invece di
 * ripartire da zero o dal solo template (`createDeviceRequestChecklist.ts`).
 *
 * Riceve dal consumer:
 * - `requestId`: id della `deviceRequest` di destinazione. Una richiesta
 *   può già avere altre checklist collegate (`checklistIds`): la clonazione
 *   aggiunge la nuova checklist tramite `arrayUnion`, fino al limite
 *   `MAX_CHECKLISTS_PER_REQUEST`.
 * - `sourceRequestId`: id della `deviceRequest` sorgente, mantenuto per
 *   audit/log e per verificare l'appartenenza di `sourceChecklistId`.
 * - `sourceChecklistId`: id esplicito della checklist da clonare, che deve
 *   appartenere a `checklistIds` della richiesta sorgente (una sorgente può
 *   avere più di una checklist: non viene più risolta implicitamente "la"
 *   checklist della sorgente). Nessuna restrizione di `devicetype` è
 *   imposta qui: la scelta della sorgente (stesso devicetype o libera) è
 *   demandata al consumer.
 * - `title` (opzionale): titolo della nuova checklist; se omesso viene
 *   generato un titolo di default a partire dal `requestNumber` della
 *   richiesta di destinazione.
 *
 * RBAC: stesso perimetro di `createDeviceRequestChecklist.ts` — admin o
 * volontario assegnato alla richiesta di *destinazione* (`changeStatus.ts`).
 * Non è richiesta alcuna relazione tra il chiamante e la richiesta
 * sorgente: la sorgente è solo un riferimento storico non vincolante
 * (`clonedFrom` sul documento `checklists/{checklistId}`, registrato dal
 * core Organizer), che può essere modificata o eliminata in seguito senza
 * impatto su questa clonazione.
 */
export const cloneDeviceRequestChecklist = onCall(
  { region: REGION },
  async (request) => {
    const invokeId = getInvokeId(request);
    console.log(`[cloneDeviceRequestChecklist] Invoke ID: ${invokeId} - Function called`);

    const authUid = request.auth?.uid;
    if (!authUid) {
      console.log("[cloneDeviceRequestChecklist] KO: Unauthenticated");
      throw new HttpsError("unauthenticated", "Authentication required");
    }

    const data = request.data ?? {};
    const { requestId, sourceRequestId, sourceChecklistId, title } = data;

    if (!requestId || typeof requestId !== "string") {
      console.log("[cloneDeviceRequestChecklist] KO: Missing or invalid requestId");
      throw new HttpsError("invalid-argument", "Missing or invalid requestId");
    }

    if (!sourceRequestId || typeof sourceRequestId !== "string") {
      console.log("[cloneDeviceRequestChecklist] KO: Missing or invalid sourceRequestId");
      throw new HttpsError("invalid-argument", "Missing or invalid sourceRequestId");
    }

    if (!sourceChecklistId || typeof sourceChecklistId !== "string") {
      console.log("[cloneDeviceRequestChecklist] KO: Missing or invalid sourceChecklistId");
      throw new HttpsError("invalid-argument", "Missing or invalid sourceChecklistId");
    }

    if (title !== undefined && title !== null && typeof title !== "string") {
      console.log("[cloneDeviceRequestChecklist] KO: title must be a string");
      throw new HttpsError("invalid-argument", "title must be a string");
    }

    const db = getFirestore();

    const requestRef = db.collection("deviceRequests").doc(requestId);
    const requestSnap = await requestRef.get();

    if (!requestSnap.exists) {
      console.log(`[cloneDeviceRequestChecklist] KO: request ${requestId} not found`);
      throw new HttpsError("not-found", "Device request not found");
    }

    const requestData = requestSnap.data() ?? {};

    const existingChecklistIds: unknown[] = Array.isArray(requestData.checklistIds)
      ? requestData.checklistIds
      : [];

    if (existingChecklistIds.length >= MAX_CHECKLISTS_PER_REQUEST) {
      console.log(
        `[cloneDeviceRequestChecklist] KO: request ${requestId} already has the maximum ` +
          `number of checklists (${MAX_CHECKLISTS_PER_REQUEST})`
      );
      throw new HttpsError(
        "failed-precondition",
        `This device request already has the maximum number of checklists (${MAX_CHECKLISTS_PER_REQUEST})`
      );
    }

    const userSnap = await db.collection("users").doc(authUid).get();
    const role = userSnap.exists ? userSnap.data()?.role : undefined;

    const isAdmin = role === "admin";
    const isAssignedVolunteer =
      role === "volunteer" &&
      Array.isArray(requestData.assignedVolunteers) &&
      requestData.assignedVolunteers.includes(authUid);

    if (!isAdmin && !isAssignedVolunteer) {
      console.log(`[cloneDeviceRequestChecklist] KO: Permission denied for uid ${authUid}`);
      throw new HttpsError(
        "permission-denied",
        "Only admin or assigned volunteers can clone a checklist for this request"
      );
    }

    const sourceRequestRef = db.collection("deviceRequests").doc(sourceRequestId);
    const sourceRequestSnap = await sourceRequestRef.get();

    if (!sourceRequestSnap.exists) {
      console.log(`[cloneDeviceRequestChecklist] KO: source request ${sourceRequestId} not found`);
      throw new HttpsError("not-found", "Source device request not found");
    }

    const sourceRequestData = sourceRequestSnap.data() ?? {};
    const sourceChecklistIds: unknown[] = Array.isArray(sourceRequestData.checklistIds)
      ? sourceRequestData.checklistIds
      : [];

    if (!sourceChecklistIds.includes(sourceChecklistId)) {
      console.log(
        `[cloneDeviceRequestChecklist] KO: checklist ${sourceChecklistId} is not linked to ` +
          `source request ${sourceRequestId}`
      );
      throw new HttpsError(
        "failed-precondition",
        "The source checklist is not linked to the source device request"
      );
    }

    const resolvedTitle: string =
      (title as string | undefined) ??
      `Checklist di fabbricazione - ${requestData.requestNumber ?? requestId}`;

    console.log(
      `[cloneDeviceRequestChecklist] Cloning checklist ${sourceChecklistId} (request ${sourceRequestId}) ` +
        `for request ${requestId}`
    );

    const result = await cloneChecklist.run({
      ...request,
      data: { sourceChecklistId, title: resolvedTitle },
    } as CallableRequest);
    const checklistId = (result as { checklistId: string }).checklistId;

    await requestRef.update({
      checklistIds: FieldValue.arrayUnion(checklistId),
      updatedAt: FieldValue.serverTimestamp(),
    });

    console.log(
      `[cloneDeviceRequestChecklist] OK: checklist ${checklistId} (cloned from ${sourceChecklistId}) ` +
        `linked to request ${requestId}`
    );

    return { checklistId };
  }
);
