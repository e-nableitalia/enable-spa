import {onCall, HttpsError} from "firebase-functions/v2/https";
import {getFirestore, FieldValue} from "firebase-admin/firestore";
import {mapToPublicStatus} from "../utils/mapToPublicStatus";
import {requireVolunteerConsents} from "../utils/consents";
import {sendChangeStatusNotifications, NotificaOptions} from "./changeStatusNotifications";
import {assertVolunteerTransitionAllowed} from "../utils/volunteerTransitions";

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

      tx.update(requestRef, {
        status: newStatus,
        publicStatus: mapToPublicStatus(newStatus),
        updatedAt: FieldValue.serverTimestamp()
      });

      tx.set(requestRef.collection("events").doc(), {
        type: "status_change",
        fromStatus: currentStatus,
        toStatus: newStatus,
        timestamp: FieldValue.serverTimestamp(),
        createdBy: uid,
        note: note || null
      });

      tx.set(
        db.collection("publicDeviceRequests").doc(requestId),
        {
          publicStatus: mapToPublicStatus(newStatus)
        },
        {merge: true}
      );
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

