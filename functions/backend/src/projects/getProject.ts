import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore } from "firebase-admin/firestore";
import { getInvokeId } from "../utils/invoke";
import { getProjectOrThrow, requireStaffRole, type ProjectDoc } from "./projectAccess";

const REGION = "europe-west1";

export interface ProjectEventDoc {
  id: string;
  fromStatus?: string;
  toStatus?: string;
  note?: string;
  createdBy?: string;
  timestamp?: unknown;
}

/**
 * Cloud Function callable del dominio "projects": lettura di un singolo
 * progetto + cronologia `events`, staff-only. Esposta al client per non
 * dipendere dalle regole Firestore dirette sul documento (il dettaglio UI
 * falliva con "Progetto non trovato" quando le rules non erano allineate,
 * mentre `listProjects` via Admin SDK funzionava).
 */
export const getProject = onCall({ region: REGION }, async (request) => {
  const invokeId = getInvokeId(request);
  console.log(`[getProject] Invoke ID: ${invokeId} - Function called`);

  const uid = request.auth?.uid;
  if (!uid) {
    throw new HttpsError("unauthenticated", "User must be authenticated");
  }

  const { projectId } = (request.data ?? {}) as { projectId?: string };
  if (!projectId || typeof projectId !== "string") {
    throw new HttpsError("invalid-argument", "Missing or invalid projectId");
  }

  const db = getFirestore();
  await requireStaffRole(db, uid);

  const project: ProjectDoc = await getProjectOrThrow(db, projectId);

  const eventsSnap = await db
    .collection("projects")
    .doc(projectId)
    .collection("events")
    .orderBy("timestamp", "desc")
    .get();

  const events: ProjectEventDoc[] = eventsSnap.docs.map((doc) => {
    const data = doc.data() ?? {};
    return {
      id: doc.id,
      fromStatus: typeof data.fromStatus === "string" ? data.fromStatus : undefined,
      toStatus: typeof data.toStatus === "string" ? data.toStatus : undefined,
      note: typeof data.note === "string" ? data.note : undefined,
      createdBy: typeof data.createdBy === "string" ? data.createdBy : undefined,
      timestamp: data.timestamp,
    };
  });

  console.log(`[getProject] OK: project ${projectId} with ${events.length} event(s) read by ${uid}`);
  return { project, events };
});
