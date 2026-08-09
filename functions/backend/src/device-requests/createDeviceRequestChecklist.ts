import { onCall, HttpsError } from "firebase-functions/v2/https";
import type { CallableRequest } from "firebase-functions/v2/https";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { getInvokeId } from "../utils/invoke";
import { createChecklist } from "../organizer/createChecklist";
import { createChecklistFromTemplate } from "../organizer/createChecklistFromTemplate";

const REGION = "europe-west1";

/**
 * Numero massimo di checklist collegabili alla stessa `deviceRequest`
 * (campo array `checklistIds`). Valore proposto in EA-130 (fasi previste:
 * fabbricazione, collaudo/qualità, più margine) — da confermare o
 * modificare dall'umano, non è una decisione definitiva presa qui.
 */
const MAX_CHECKLISTS_PER_REQUEST = 5;

/**
 * Cloud Function callable del layer di integrazione device-requests: crea
 * la checklist Organizer collegata a una `deviceRequest` e ne aggiunge il
 * riferimento al campo array `deviceRequests/{requestId}.checklistIds`.
 *
 * Il core Organizer (`organizer/createChecklist.ts`,
 * `organizer/createChecklistFromTemplate.ts`) non conosce il concetto di
 * deviceRequest e non mantiene un back-reference: questo layer introduce
 * sul documento `deviceRequests/{requestId}` il campo `checklistIds`,
 * esteso qui alla creazione tramite `arrayUnion` (relazione 1:N, stesso
 * pattern già usato da `assignedVolunteers` sullo stesso documento — vedi
 * `device/createDeviceRequest.ts`). Una richiesta può avere più checklist
 * (es. fabbricazione, collaudo), fino al limite `MAX_CHECKLISTS_PER_REQUEST`.
 *
 * RBAC: la creazione è permessa solo all'admin o ai volontari assegnati
 * alla richiesta (`assignedVolunteers`), stesso pattern di controllo
 * ruolo/assegnazione usato in `device/changeStatus.ts`.
 *
 * Se esiste un template di checklist per il `devicetype` della richiesta
 * (documento `templates` con `category === devicetype`), la nuova
 * checklist viene istanziata da quel template
 * (`organizer/createChecklistFromTemplate`, il primo template trovato per
 * quella categoria). Altrimenti viene creata una checklist vuota
 * (`organizer/createChecklist`).
 *
 * Riceve dal consumer:
 * - `requestId`: id del documento `deviceRequests/{requestId}`.
 * - `title` (opzionale): titolo della checklist; se omesso viene generato
 *   un titolo di default a partire dal `requestNumber` della richiesta.
 * - `items` (opzionale): elenco di item iniziali espliciti (stessa forma
 *   accettata da `organizer/createChecklist`, es. `{ title, type }`). Se
 *   presente, ha precedenza sulla risoluzione da template: nessun lookup su
 *   `templates` viene eseguito e la checklist viene creata con esattamente
 *   questi item (`organizer/createChecklist`). Introdotto per l'auto-
 *   istanziazione della checklist di produzione (EA-151,
 *   `device-requests/autoCreateProductionChecklist.ts`), ma non riservato:
 *   qualunque consumer autorizzato può fornirlo, coerentemente con
 *   `organizer/createChecklist` che accetta già `items` arbitrari da
 *   qualunque utente autenticato.
 */
export const createDeviceRequestChecklist = onCall(
  { region: REGION },
  async (request) => {
    const invokeId = getInvokeId(request);
    console.log(`[createDeviceRequestChecklist] Invoke ID: ${invokeId} - Function called`);

    const authUid = request.auth?.uid;
    if (!authUid) {
      console.log("[createDeviceRequestChecklist] KO: Unauthenticated");
      throw new HttpsError("unauthenticated", "Authentication required");
    }

    const data = request.data ?? {};
    const { requestId, title, items } = data;

    if (!requestId || typeof requestId !== "string") {
      console.log("[createDeviceRequestChecklist] KO: Missing or invalid requestId");
      throw new HttpsError("invalid-argument", "Missing or invalid requestId");
    }

    if (title !== undefined && title !== null && typeof title !== "string") {
      console.log("[createDeviceRequestChecklist] KO: title must be a string");
      throw new HttpsError("invalid-argument", "title must be a string");
    }

    if (items !== undefined && !Array.isArray(items)) {
      console.log("[createDeviceRequestChecklist] KO: items must be an array");
      throw new HttpsError("invalid-argument", "items must be an array");
    }

    const db = getFirestore();

    const requestRef = db.collection("deviceRequests").doc(requestId);
    const requestSnap = await requestRef.get();

    if (!requestSnap.exists) {
      console.log(`[createDeviceRequestChecklist] KO: request ${requestId} not found`);
      throw new HttpsError("not-found", "Device request not found");
    }

    const requestData = requestSnap.data() ?? {};

    const existingChecklistIds: unknown[] = Array.isArray(requestData.checklistIds)
      ? requestData.checklistIds
      : [];

    if (existingChecklistIds.length >= MAX_CHECKLISTS_PER_REQUEST) {
      console.log(
        `[createDeviceRequestChecklist] KO: request ${requestId} already has the maximum ` +
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
      console.log(`[createDeviceRequestChecklist] KO: Permission denied for uid ${authUid}`);
      throw new HttpsError(
        "permission-denied",
        "Only admin or assigned volunteers can create the checklist for this request"
      );
    }

    // `devicetype`: sorgente primaria il campo `deviceType` del documento
    // principale, fallback la proiezione pubblica
    // `publicDeviceRequests/{requestId}.devicetype` (dove il devicetype è
    // effettivamente scritto dal flusso di validazione/cambio tipo device).
    let devicetype: string | undefined =
      typeof requestData.deviceType === "string" && requestData.deviceType.trim() !== ""
        ? requestData.deviceType
        : undefined;

    if (!devicetype) {
      const publicSnap = await db.collection("publicDeviceRequests").doc(requestId).get();
      const publicDevicetype = publicSnap.exists ? publicSnap.data()?.devicetype : undefined;
      if (typeof publicDevicetype === "string" && publicDevicetype.trim() !== "") {
        devicetype = publicDevicetype;
      }
    }

    const resolvedTitle: string =
      (title as string | undefined) ??
      `Checklist di fabbricazione - ${requestData.requestNumber ?? requestId}`;

    let templateId: string | undefined;
    if (devicetype && items === undefined) {
      const templatesSnap = await db
        .collection("templates")
        .where("category", "==", devicetype)
        .limit(1)
        .get();
      if (!templatesSnap.empty) {
        templateId = templatesSnap.docs[0].id;
      }
    }

    let checklistId: string;
    if (items !== undefined) {
      console.log(
        `[createDeviceRequestChecklist] Creating checklist with ${items.length} explicit item(s) ` +
          `for request ${requestId}`
      );
      const result = await createChecklist.run({
        ...request,
        data: { category: devicetype ?? "unknown", title: resolvedTitle, items },
      } as CallableRequest);
      checklistId = (result as { checklistId: string }).checklistId;
    } else if (templateId) {
      console.log(
        `[createDeviceRequestChecklist] Instantiating checklist from template ${templateId} ` +
          `(devicetype ${devicetype}) for request ${requestId}`
      );
      const result = await createChecklistFromTemplate.run({
        ...request,
        data: { templateId, title: resolvedTitle, category: devicetype },
      } as CallableRequest);
      checklistId = (result as { checklistId: string }).checklistId;
    } else {
      console.log(
        `[createDeviceRequestChecklist] No template found for devicetype ${devicetype ?? "unknown"}; ` +
          `creating blank checklist for request ${requestId}`
      );
      const result = await createChecklist.run({
        ...request,
        data: { category: devicetype ?? "unknown", title: resolvedTitle, items: [] },
      } as CallableRequest);
      checklistId = (result as { checklistId: string }).checklistId;
    }

    await requestRef.update({
      checklistIds: FieldValue.arrayUnion(checklistId),
      updatedAt: FieldValue.serverTimestamp(),
    });

    console.log(
      `[createDeviceRequestChecklist] OK: checklist ${checklistId} linked to request ${requestId}`
    );

    return { checklistId };
  }
);
