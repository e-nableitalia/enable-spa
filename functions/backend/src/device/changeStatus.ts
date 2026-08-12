import {onCall, HttpsError} from "firebase-functions/v2/https";
import {getFirestore} from "firebase-admin/firestore";
import {applyStatusChangeTransaction} from "./applyStatusChangeTransaction";
import {requireVolunteerConsents} from "../utils/consents";
import {sendChangeStatusNotifications, NotificaOptions} from "./changeStatusNotifications";
import {assertVolunteerTransitionAllowed} from "../utils/volunteerTransitions";
import {autoCreateProductionChecklistOnTransition} from "../device-requests/autoCreateProductionChecklist";

/**
 * Stati verso cui la transizione richiede lo scarico di responsabilità
 * acquisito (EA-159). Indipendente da ruolo/percorso: si applica sia
 * all'admin sia al volontario, e indipendentemente dal currentStatus di
 * partenza — vedi `waiverAcquired` sotto.
 */
const STATUSES_REQUIRING_WAIVER = new Set([
  "pronta per spedizione",
  "spedita",
  "completata",
]);

export const changeStatus = onCall(
  {
    region: "europe-west1",
    secrets: [
      "TELEGRAM_API_URL",
      "TELEGRAM_API_SECRET",
    ],
  },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) {
      throw new HttpsError("unauthenticated", "User must be authenticated");
    }

    await requireVolunteerConsents(uid);
    const {requestId, newStatus, note, notifica} = request.data as {
      requestId: string;
      newStatus: string;
      note?: string;
      notifica?: NotificaOptions;
    };

    if (!requestId || !newStatus) {
      throw new HttpsError("invalid-argument", "Missing parameters");
    }

    const db = getFirestore();

    const userSnap = await db.collection("users").doc(uid).get();
    if (!userSnap.exists) {
      throw new HttpsError("permission-denied", "User not found");
    }

    const role = userSnap.data()?.role;

    const requestRef = db.collection("deviceRequests").doc(requestId);
    const requestSnap = await requestRef.get();

    if (!requestSnap.exists) {
      throw new HttpsError("not-found", "Request not found");
    }

    const requestData = requestSnap.data();
    const currentStatus = requestData?.status;

    assertVolunteerTransitionAllowed(
      role,
      uid,
      requestData?.assignedVolunteers,
      currentStatus,
      newStatus
    );

    // --- Gate obbligatorio: scarico di responsabilità (EA-159) ---
    // Trasversale a ruolo e a currentStatus di partenza: si applica anche a
    // transizioni dirette verso uno dei 3 stati target da un currentStatus
    // non immediatamente precedente, se ammesse da RBAC. Nessun backfill sui
    // dati pregressi: le richieste già in uno di questi stati non vengono
    // ricontrollate, il gate riguarda solo le transizioni future.
    if (STATUSES_REQUIRING_WAIVER.has(newStatus) && requestData?.waiverAcquired !== true) {
      throw new HttpsError(
        "failed-precondition",
        "Impossibile procedere: lo scarico di responsabilità non è stato acquisito per questa richiesta"
      );
    }

    await db.runTransaction(async (tx) => {
      applyStatusChangeTransaction(tx, requestRef, {
        currentStatus,
        newStatus,
        createdBy: uid,
        note
      });
    });

    // --- Auto-istanziazione checklist di produzione (EA-151) ---
    // Nessun gate: un eventuale fallimento non blocca la transizione di
    // stato, già commitata sopra. Il guard di idempotenza è letto e
    // "claimato" atomicamente dentro autoCreateProductionChecklist.ts
    // stesso (non qui): un valore letto prima di questa transazione, come
    // in una prima versione di questo modulo, sarebbe stale sotto due
    // changeStatus quasi simultanei sulla stessa richiesta.
    await autoCreateProductionChecklistOnTransition(request, {
      requestId,
      newStatus,
    });

    // --- Notifiche opzionali ---
    if (notifica) {
      await sendChangeStatusNotifications({
        db,
        requestId,
        requestData,
        currentStatus,
        newStatus,
        note,
        notifica,
      });
    }

    return {success: true};
  }
);

