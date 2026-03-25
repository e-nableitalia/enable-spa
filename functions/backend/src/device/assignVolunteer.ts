import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore } from "firebase-admin/firestore";
import { requireVolunteerConsents } from "../utils/consents";
import { setAssignedVolunteers } from "../utils/volunteerAssignment";
import { getInvokeId } from "../utils/invoke";

export const assignVolunteer = onCall(
  { region: "europe-west1" },
  async (request) => {
    const invokeId = getInvokeId(request);
    const { deviceId, userId } = request.data;
    const authUid = request.auth?.uid;
    console.log(`[assignVolunteer] Invoke ID: ${invokeId} - Function called`);

    if (!authUid) {
      console.log(`[assignVolunteer] KO: Unauthenticated`);
      throw new HttpsError("unauthenticated", "User must be authenticated");
    }

    await requireVolunteerConsents(authUid);
    if (!deviceId || userId === undefined || userId === null) {
      console.log(`[assignVolunteer] KO: Missing parameters`);
      throw new HttpsError("invalid-argument", "Missing parameters");
    }

    const db = getFirestore();
    const userSnap = await db.collection("users").doc(authUid).get();
    if (!userSnap.exists || userSnap.data()?.role !== "admin") {
      console.log(`[assignVolunteer] KO: Permission denied for uid ${authUid}`);
      throw new HttpsError("permission-denied", "Only admin can assign volunteers");
    }

    // Accept either a single UID or a full array (complete desired list)
    const volunteerIds: string[] = Array.isArray(userId) ? userId : [userId];
    console.log(`[assignVolunteer] Setting volunteers for request ${deviceId}: [${volunteerIds.join(", ")}]`);

    await setAssignedVolunteers(deviceId, volunteerIds, authUid, invokeId);
    console.log(`[assignVolunteer] OK: volunteers set for request ${deviceId}`);

    return { success: true };
  }
);
