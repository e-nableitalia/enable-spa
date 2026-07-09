import { getFirestore } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";

/**
 * Verifica che l'utente autenticato `uid` abbia ruolo `admin`, leggendo
 * `users/{uid}.role` da Firestore. Stesso pattern di controllo già usato
 * in `device/assignVolunteer.ts`.
 *
 * Lancia `permission-denied` se l'utente non esiste o non è admin.
 * `logPrefix` viene usato per uniformare il log di KO al tag della
 * funzione chiamante (es. `[createDeviceChecklistTemplate]`).
 */
export async function requireAdminRole(uid: string, logPrefix: string): Promise<void> {
  const db = getFirestore();
  const userSnap = await db.collection("users").doc(uid).get();

  if (!userSnap.exists || userSnap.data()?.role !== "admin") {
    console.log(`${logPrefix} KO: Permission denied for uid ${uid}`);
    throw new HttpsError("permission-denied", "Only admin can manage checklist templates");
  }
}
