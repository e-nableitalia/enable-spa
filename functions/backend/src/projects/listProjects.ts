import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore } from "firebase-admin/firestore";
import { getInvokeId } from "../utils/invoke";
import { requireStaffRole, type ProjectDoc, type ProjectRecord } from "./projectAccess";

const REGION = "europe-west1";

/**
 * Cloud Function callable del dominio "projects": elenco completo dei
 * progetti/iniziative/eventi, staff-only (admin+volontario). Nessuna
 * restrizione per-utente (a differenza di `deviceRequests`, qui non esiste
 * un concetto di "assegnazione" a livello di intero progetto) — il filtro
 * per `projectType` è demandato al client, stesso principio già scelto per
 * il filtro categoria degli Allegati.
 */
export const listProjects = onCall({ region: REGION }, async (request) => {
  const invokeId = getInvokeId(request);
  console.log(`[listProjects] Invoke ID: ${invokeId} - Function called`);

  const uid = request.auth?.uid;
  if (!uid) {
    throw new HttpsError("unauthenticated", "User must be authenticated");
  }

  const db = getFirestore();
  await requireStaffRole(db, uid);

  const snap = await db.collection("projects").orderBy("createdAt", "desc").get();
  const projects: ProjectDoc[] = snap.docs.map((doc) => ({
    id: doc.id,
    ...(doc.data() as ProjectRecord),
  }));

  console.log(`[listProjects] OK: ${projects.length} project(s) read by ${uid}`);
  return { projects };
});
