import {onCall, HttpsError} from "firebase-functions/v2/https";
import {getFirestore, FieldValue} from "firebase-admin/firestore";
import {mapToPublicStatus} from "../utils/mapToPublicStatus";

export const changeStatus = onCall(
  {region: "europe-west1"},
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) {
      throw new HttpsError("unauthenticated", "User must be authenticated");
    }

    const {requestId, newStatus, note} = request.data;

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

    // --- Controllo ruolo ---
    if (role === "admin") {
      // Admin può fare qualsiasi transizione
    } else if (role === "volunteer") {
      if (requestData?.assignedVolunteer !== uid) {
        throw new HttpsError("permission-denied", "Not assigned volunteer");
      }

      if (!isAllowedVolunteerTransition(currentStatus, newStatus)) {
        throw new HttpsError("permission-denied", "Invalid status transition");
      }
    } else {
      throw new HttpsError("permission-denied", "Invalid role");
    }

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

    return {success: true};
  }
);

function isAllowedVolunteerTransition(from: string, to: string): boolean {
  return (
    (from === "scelta device e dimensionamento" && to === "personalizzazione") ||
    (from === "personalizzazione" && to === "attesa materiali") ||
    (from === "attesa materiali" && to === "fabbricazione") ||
    (from === "fabbricazione" && to === "pronta per spedizione") ||
    (from === "pronta per spedizione" && to === "spedita")
  );
}

