import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

const REGION = "europe-west1";
const CURRENT_CONSENT_VERSION = "2026-03";

export const acceptVolunteerConsents = onCall(
  { region: REGION },
  async (req) => {
    if (!req.auth) {
      throw new HttpsError("unauthenticated", "Authentication required");
    }

    const uid = req.auth.uid;
    const db = getFirestore();

    await db.collection("users").doc(uid).set({
      consents: {
        privacy: {
          accepted: true,
          acceptedAt: FieldValue.serverTimestamp(),
          version: CURRENT_CONSENT_VERSION,
        },
        codeOfConduct: {
          accepted: true,
          acceptedAt: FieldValue.serverTimestamp(),
          version: CURRENT_CONSENT_VERSION,
        },
      },
    }, { merge: true });

    return { success: true };
  }
);
