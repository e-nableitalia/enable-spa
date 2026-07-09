import { onCall, HttpsError } from "firebase-functions/v2/https";
import type { CallableRequest } from "firebase-functions/v2/https";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { getInvokeId } from "../utils/invoke";
import { createChecklist } from "../organizer/createChecklist";
import { createChecklistFromTemplate } from "../organizer/createChecklistFromTemplate";

const REGION = "europe-west1";

/**
 * Cloud Function callable del layer di integrazione device-requests: crea
 * la checklist Organizer collegata a una `deviceRequest` e ne salva il
 * riferimento (`checklistId`) sul documento `deviceRequests/{requestId}`.
 *
 * Il core Organizer (`organizer/createChecklist.ts`,
 * `organizer/createChecklistFromTemplate.ts`) non conosce il concetto di
 * deviceRequest e non mantiene un back-reference: questo layer introduce
 * sul documento `deviceRequests/{requestId}` il campo `checklistId`,
 * valorizzato qui alla creazione.
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
    const { requestId, title } = data;

    if (!requestId || typeof requestId !== "string") {
      console.log("[createDeviceRequestChecklist] KO: Missing or invalid requestId");
      throw new HttpsError("invalid-argument", "Missing or invalid requestId");
    }

    if (title !== undefined && title !== null && typeof title !== "string") {
      console.log("[createDeviceRequestChecklist] KO: title must be a string");
      throw new HttpsError("invalid-argument", "title must be a string");
    }

    const db = getFirestore();

    const requestRef = db.collection("deviceRequests").doc(requestId);
    const requestSnap = await requestRef.get();

    if (!requestSnap.exists) {
      console.log(`[createDeviceRequestChecklist] KO: request ${requestId} not found`);
      throw new HttpsError("not-found", "Device request not found");
    }

    const requestData = requestSnap.data() ?? {};

    if (requestData.checklistId) {
      console.log(`[createDeviceRequestChecklist] KO: request ${requestId} already has a checklist`);
      throw new HttpsError(
        "already-exists",
        "A checklist is already linked to this device request"
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
    if (devicetype) {
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
    if (templateId) {
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
      checklistId,
      updatedAt: FieldValue.serverTimestamp(),
    });

    console.log(
      `[createDeviceRequestChecklist] OK: checklist ${checklistId} linked to request ${requestId}`
    );

    return { checklistId };
  }
);
