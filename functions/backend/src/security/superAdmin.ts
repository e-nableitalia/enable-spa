import type { Firestore } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";

/**
 * Verifica che l'utente autenticato `uid` abbia il flag `superAdmin: true`
 * su `users/{uid}` (Epic EA-171) — additivo a `role: "admin"`, mai un
 * terzo valore di `role`: nessun controllo `role === "admin"` esistente
 * nel codice viene toccato da questo helper.
 *
 * Bootstrap del flag solo manuale in console Firestore (decisione
 * esplicita dell'operatore): nessuna Cloud Function legge o scrive questo
 * campo per conto di altri utenti, questo helper lo legge soltanto per
 * l'uid del chiamante.
 *
 * Lancia `permission-denied` se l'utente non esiste o non ha il flag.
 */
export async function requireSuperAdmin(db: Firestore, uid: string): Promise<void> {
  const userSnap = await db.collection("users").doc(uid).get();

  if (!userSnap.exists || userSnap.data()?.superAdmin !== true) {
    throw new HttpsError("permission-denied", "Only a super admin can perform this action");
  }
}
