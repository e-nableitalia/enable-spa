import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { requireVolunteerConsents } from "../utils/consents";

export const assignVolunteer = onCall(
  { region: "europe-west1" },
  async (request) => {
    const { deviceId, userId } = request.data;
    const authUid = request.auth?.uid;

    if (!authUid) {
      throw new HttpsError("unauthenticated", "User must be authenticated");
    }

    await requireVolunteerConsents(authUid);
    if (!deviceId || !userId) {
      throw new HttpsError("invalid-argument", "Missing parameters");
    }

    const db = getFirestore();

    // Check if the requester is admin
    const userSnap = await db.collection("users").doc(authUid).get();
    if (!userSnap.exists || userSnap.data()?.role !== "admin") {
      throw new HttpsError("permission-denied", "Only admin can assign volunteers");
    }

    const requestRef = db.collection("deviceRequests").doc(deviceId);
    const requestSnap = await requestRef.get();

    if (!requestSnap.exists) {
      throw new HttpsError("not-found", "Device request not found");
    }

    // Recupera stato attuale della richiesta
    const requestData = requestSnap.data();
    const fromStatus = requestData?.status || null;

    // Recupera nome e cognome del volontario
    let volunteerNote = userId;
    try {
      const profileSnap = await db
        .collection("users")
        .doc(userId)
        .collection("private")
        .doc("profile")
        .get();
      if (profileSnap.exists) {
        const { firstName, lastName } = profileSnap.data() || {};
        if (firstName || lastName) {
          volunteerNote = `${firstName || ""} ${lastName || ""}`.trim() + ` (${userId})`;
        }
      }
    } catch {
      // fallback: keep userId only
    }

    await db.runTransaction(async (tx) => {
      tx.update(requestRef, {
        assignedVolunteer: userId,
        updatedAt: FieldValue.serverTimestamp(),
      });

      tx.set(requestRef.collection("events").doc(), {
        type: "assign_volunteer",
        fromStatus,
        toStatus: fromStatus,
        timestamp: FieldValue.serverTimestamp(),
        createdBy: authUid,
        note: volunteerNote
      });
    });

    return { success: true };
  }
);
