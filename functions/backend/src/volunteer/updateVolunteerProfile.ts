// Abilita un volontario e invia una mail di conferma
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { initializeApp } from "firebase-admin/app";
import { logSecurityEvent } from "../security/securityLog";
import { getInvokeId } from "../utils/invoke";

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
    const invokeId = getInvokeId(req);
    console.log(`[updateVolunteerProfile] Invoke ID: ${invokeId} - Function called`);
    const { auth, data, rawRequest } = req;
    if (!auth) {
      console.log(`[updateVolunteerProfile] KO: Unauthenticated`);
      throw new HttpsError("unauthenticated", "Authentication required");
    }
    const uid = auth.uid;
    console.log(`[updateVolunteerProfile] uid: ${uid}`);
    const role = await getUserRole(uid);
    console.log(`[updateVolunteerProfile] role: ${role}`);
    if (role !== "volunteer" && role !== "admin") {
      console.log(`[updateVolunteerProfile] KO: Permission denied for role ${role}`);
      throw new HttpsError("permission-denied", "Only volunteers or admins can update profile");
    }

    const { privateProfile, skills, publicProfile } = data;
    console.log(`[updateVolunteerProfile] Sections to update: privateProfile=${!!privateProfile}, skills=${!!skills}, publicProfile=${!!publicProfile}`);

    if (privateProfile && privateProfile.consentPrivacy !== true) {
      console.log(`[updateVolunteerProfile] KO: consentPrivacy not true`);
      throw new HttpsError("failed-precondition", "consentPrivacy must be true");
    }

    // Normalize and validate notificationPreferences
    if (privateProfile) {
      const prefs = privateProfile.notificationPreferences;
      if (prefs) {
        // Validate channel requirements
        if (prefs.telegram && !privateProfile.telegramUsername) {
          throw new HttpsError("failed-precondition", "Telegram selected but username missing");
        }
        if (prefs.whatsapp && !privateProfile.phone) {
          throw new HttpsError("failed-precondition", "WhatsApp selected but phone missing");
        }
        // Force at least one channel active
        const hasAny = prefs.email || prefs.telegram || prefs.whatsapp;
        if (!hasAny) {
          privateProfile.notificationPreferences = { email: true };
        }
      }
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
      console.log(`[updateVolunteerProfile] OK: profile updated for uid ${uid}`);
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
          invokeId,
        },
      });
      return { success: true };
    } catch (error) {
      errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`[updateVolunteerProfile] KO: ${errorMsg}`);
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
          invokeId,
          metadata: { error: errorMsg },
        },
      });
      throw new HttpsError("internal", "Errore aggiornamento profilo volontario");
    }
  }
);
