import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";
import { logSecurityEvent } from "../security/securityLog";

/**
 * Sets the complete list of volunteers assigned to a device request.
 * Overwrites the existing assignedVolunteers array with the provided list.
 * Records an event in the request's events subcollection.
 *
 * @param deviceId - Firestore document ID of the deviceRequest
 * @param volunteerIds - Full desired list of volunteer UIDs
 * @param actorUid - UID of the admin performing the action
 * @param invokeId - Invoke ID for logging correlation
 */
export async function setAssignedVolunteers(
  deviceId: string,
  volunteerIds: string[],
  actorUid: string,
  invokeId: string
): Promise<void> {
  const db = getFirestore();
  const requestRef = db.collection("deviceRequests").doc(deviceId);
  const requestSnap = await requestRef.get();

  if (!requestSnap.exists) {
    throw new HttpsError("not-found", `Device request ${deviceId} not found`);
  }

  const fromStatus = requestSnap.data()?.status ?? null;

  const names = await Promise.all(volunteerIds.map(resolveVolunteerNote));
  const noteText =
    volunteerIds.length === 0
      ? "Nessun volontario assegnato"
      : `Volontari assegnati: ${names.join(", ")}`;

  let errorMsg: string | undefined;
  try {
    await db.runTransaction(async (tx) => {
      tx.update(requestRef, {
        assignedVolunteers: volunteerIds,
        updatedAt: FieldValue.serverTimestamp(),
      });

      tx.set(requestRef.collection("events").doc(), {
        type: "set_volunteers",
        fromStatus,
        toStatus: fromStatus,
        timestamp: FieldValue.serverTimestamp(),
        createdBy: actorUid,
        note: noteText,
      });
    });

    await logSecurityEvent({
      type: "system",
      action: "set_assigned_volunteers",
      outcome: "success",
      severity: "medium",
      actor: { uid: actorUid },
      context: {
        function: "setAssignedVolunteers",
        invokeId,
        metadata: { deviceId, volunteerIds },
      },
    });
  } catch (error) {
    errorMsg = error instanceof Error ? error.message : String(error);
    await logSecurityEvent({
      type: "system",
      action: "set_assigned_volunteers",
      outcome: "failure",
      severity: "high",
      actor: { uid: actorUid },
      context: {
        function: "setAssignedVolunteers",
        invokeId,
        metadata: { deviceId, volunteerIds, error: errorMsg },
      },
    });
    throw error;
  }
}

/**
 * Resolves a volunteer's full name for event notes.
 * Falls back to the raw userId if the profile is unavailable.
 */
export async function resolveVolunteerNote(volunteerId: string): Promise<string> {
  try {
    const db = getFirestore();
    const profileSnap = await db
      .collection("users")
      .doc(volunteerId)
      .collection("private")
      .doc("profile")
      .get();
    if (profileSnap.exists) {
      const { firstName, lastName } = profileSnap.data() ?? {};
      if (firstName || lastName) {
        return `${firstName ?? ""} ${lastName ?? ""}`.trim() + ` (${volunteerId})`;
      }
    }
  } catch {
    // fallback: keep userId only
  }
  return volunteerId;
}
