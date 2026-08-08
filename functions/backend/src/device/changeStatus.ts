import {onCall, HttpsError} from "firebase-functions/v2/https";
import {getFirestore} from "firebase-admin/firestore";
import {applyStatusChangeTransaction} from "./applyStatusChangeTransaction";
import {requireVolunteerConsents} from "../utils/consents";
import {sendChangeStatusNotifications, NotificaOptions} from "./changeStatusNotifications";
import {assertVolunteerTransitionAllowed} from "../utils/volunteerTransitions";
import {autoCreateProductionChecklistOnTransition} from "../device-requests/autoCreateProductionChecklist";

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
    // stato, già commitata sopra (vedi autoCreateProductionChecklist.ts).
    await autoCreateProductionChecklistOnTransition(request, {
      requestId,
      newStatus,
      productionChecklistAlreadyCreated: Boolean(requestData?.productionChecklistCreated),
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

