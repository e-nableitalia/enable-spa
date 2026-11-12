import { getFirestore } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";
import crypto from "crypto";

const db = getFirestore();

const EMAIL_WINDOW = 5 * 60 * 1000; // 5 min
const IP_WINDOW = 60 * 60 * 1000;   // 1 ora
const MAX_IP_REQUESTS = 3;

export async function checkEmailRateLimit(email: string) {
  const ref = db.collection("rateLimits").doc(`email_${email}`);
  const now = Date.now();

  const snap = await ref.get();

  if (snap.exists && now - snap.data()!.lastRequest < EMAIL_WINDOW) {
    throw new HttpsError("resource-exhausted", "Too many email requests");
  }

  await ref.set({ lastRequest: now });
}

function sha256(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

/**
 * Rate limit per IP. `scope` separa i contatori delle diverse form pubbliche
 * (es. "contact"); senza scope resta la chiave storica `ip_<hash>` condivisa
 * da richiesta device e registrazione.
 */
export async function checkIpRateLimit(ip: string, scope?: string) {
  const ipHash = sha256(ip);
  const docId = scope ? `ip_${scope}_${ipHash}` : `ip_${ipHash}`;
  const ref = db.collection("rateLimits").doc(docId);
  const now = Date.now();

  const snap = await ref.get();

  if (snap.exists) {
    const data = snap.data()!;
    if (now - data.windowStart < IP_WINDOW && data.count >= MAX_IP_REQUESTS) {
      throw new HttpsError("resource-exhausted", "Too many requests from this IP");
    }

    if (now - data.windowStart < IP_WINDOW) {
      await ref.update({ count: data.count + 1 });
      return;
    }
  }

  await ref.set({
    windowStart: now,
    count: 1,
  });
}

/**
 * Rate limit per contatto (email o telefono) della form pubblica di contatto:
 * stessa finestra di `checkEmailRateLimit`, ma la chiave e' un hash, cosi' in
 * `rateLimits` non finiscono email o telefoni in chiaro.
 */
export async function checkContactRateLimit(contactKey: string) {
  const ref = db.collection("rateLimits").doc(`contact_${sha256(contactKey)}`);
  const now = Date.now();

  const snap = await ref.get();

  if (snap.exists && now - (snap.data()?.lastRequest ?? 0) < EMAIL_WINDOW) {
    throw new HttpsError("resource-exhausted", "Too many contact requests");
  }

  await ref.set({ lastRequest: now });
}
