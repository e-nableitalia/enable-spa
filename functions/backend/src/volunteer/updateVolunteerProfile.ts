// Abilita un volontario e invia una mail di conferma
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { initializeApp } from "firebase-admin/app";
import { logSecurityEvent } from "../security/securityLog";

initializeApp();

const db = getFirestore();
const REGION = "europe-west1";

// Helper: Get user role
async function getUserRole(uid: string): Promise<string> {
  const userDoc = await db.collection("users").doc(uid).get();
  if (!userDoc.exists) throw new HttpsError("not-found", "User not found");
  const role = userDoc.get("role");
  if (!role) throw new HttpsError("failed-precondition", "Role missing");
  return role;
}

// 1️⃣ updateVolunteerProfile
export const updateVolunteerProfile = onCall(
  { region: REGION },
  async (req) => {
    const { auth, data, rawRequest } = req;
    if (!auth) throw new HttpsError("unauthenticated", "Authentication required");
    const uid = auth.uid;
    const role = await getUserRole(uid);
    if (role !== "volunteer") throw new HttpsError("permission-denied", "Only volunteers can update profile");

    const { privateProfile, skills, publicProfile } = data;

    if (privateProfile && privateProfile.consentPrivacy !== true) {
      throw new HttpsError("failed-precondition", "consentPrivacy must be true");
    }

    let errorMsg = undefined;
    try {
      await db.runTransaction(async (tx) => {
        const userRef = db.collection("users").doc(uid);
        if (privateProfile) {
          tx.set(userRef.collection("private").doc("profile"), {
            ...privateProfile,
            updatedAt: FieldValue.serverTimestamp(),
          }, { merge: true });
        }
        if (skills) {
          tx.set(userRef.collection("private").doc("skills"), {
            ...skills,
            updatedAt: FieldValue.serverTimestamp(),
          }, { merge: true });
        }
        if (publicProfile) {
          tx.set(userRef.collection("public").doc("profile"), {
            ...publicProfile,
            updatedAt: FieldValue.serverTimestamp(),
          }, { merge: true });
        }
      });
      // Log security event: successo
      await logSecurityEvent({
        type: "system",
        action: "update_volunteer_profile",
        outcome: "success",
        severity: "medium",
        actor: {
          uid,
          email: auth.token?.email,
          ip: rawRequest?.ip ?? "unknown",
        },
        context: {
          function: "updateVolunteerProfile",
        },
      });
      return { success: true };
    } catch (error) {
      errorMsg = error instanceof Error ? error.message : String(error);
      console.error("Errore updateVolunteerProfile:", error);
      // Log security event: errore
      await logSecurityEvent({
        type: "system",
        action: "update_volunteer_profile",
        outcome: "failure",
        severity: "high",
        actor: {
          uid,
          email: auth.token?.email,
          ip: rawRequest?.ip ?? "unknown",
        },
        context: {
          function: "updateVolunteerProfile",
          metadata: { error: errorMsg },
        },
      });
      throw new HttpsError("internal", "Errore aggiornamento profilo volontario");
    }
  }
);
