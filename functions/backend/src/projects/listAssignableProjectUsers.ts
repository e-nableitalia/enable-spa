import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore } from "firebase-admin/firestore";
import { getInvokeId } from "../utils/invoke";
import { requireStaffRole } from "./projectAccess";

const REGION = "europe-west1";

/**
 * Cloud Function callable del dominio "projects": risolve lato server
 * l'elenco degli utenti assegnabili a un item di checklist di progetto —
 * tutti gli admin più tutti i volontari attivi, nessuna restrizione
 * "per-progetto" (a differenza dell'equivalente device-requests, qui non
 * esiste un concetto di `assignedVolunteers` per singolo progetto: qualunque
 * volontario attivo può operare su qualunque progetto non terminale/non in
 * standby, vedi `isResolvableProjectAssignee`).
 */
export const listAssignableProjectUsers = onCall({ region: REGION }, async (request) => {
  const invokeId = getInvokeId(request);
  console.log(`[listAssignableProjectUsers] Invoke ID: ${invokeId} - Function called`);

  const uid = request.auth?.uid;
  if (!uid) {
    throw new HttpsError("unauthenticated", "User must be authenticated");
  }

  const db = getFirestore();
  await requireStaffRole(db, uid);

  const [adminsSnap, volunteersSnap] = await Promise.all([
    db.collection("users").where("role", "==", "admin").get(),
    db.collection("users").where("role", "==", "volunteer").where("active", "==", true).get(),
  ]);

  const uids = Array.from(
    new Set([...adminsSnap.docs.map((doc) => doc.id), ...volunteersSnap.docs.map((doc) => doc.id)])
  );

  console.log(`[listAssignableProjectUsers] OK: ${uids.length} assignable user(s) read by ${uid}`);
  return { uids };
});
