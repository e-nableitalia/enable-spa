import { getFirestore } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";

const CURRENT_CONSENT_VERSION = "2026-03";

export async function requireVolunteerConsents(uid: string): Promise<void> {
  const db = getFirestore();
  const userDoc = await db.collection("users").doc(uid).get();

  if (!userDoc.exists) {
    throw new HttpsError("not-found", "User not found");
  }

  const consents = userDoc.data()?.consents;

  const privacyOk =
    consents?.privacy?.accepted === true &&
    consents?.privacy?.version === CURRENT_CONSENT_VERSION;

  const codeOk =
    consents?.codeOfConduct?.accepted === true &&
    consents?.codeOfConduct?.version === CURRENT_CONSENT_VERSION;

  if (!privacyOk || !codeOk) {
    throw new HttpsError("failed-precondition", "Required consents not accepted");
  }
}
