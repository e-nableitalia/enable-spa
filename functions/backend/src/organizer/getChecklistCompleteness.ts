import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore } from "firebase-admin/firestore";
import { getInvokeId } from "../utils/invoke";
import { isChecklistComplete, ChecklistItemLike } from "./checklistCompleteness";

const REGION = "europe-west1";

/**
 * getChecklistCompleteness: espone al consumer lo stato di completezza di
 * una checklist esistente (gate di completezza, Epic EA-3).
 *
 * Confine architetturale: questa funzione legge la checklist e restituisce
 * l'esito del gate di completezza (`complete: boolean`) — non blocca
 * nulla, non esegue transizioni di stato, non modifica il documento. Il
 * consumer decide cosa fare dell'esito.
 */
export const getChecklistCompleteness = onCall(
  { region: REGION },
  async (request) => {
    const invokeId = getInvokeId(request);
    console.log(`[getChecklistCompleteness] Invoke ID: ${invokeId} - Function called`);

    const uid = request.auth?.uid;
    if (!uid) {
      throw new HttpsError("unauthenticated", "User must be authenticated");
    }

    const { checklistId } = request.data as { checklistId?: string };
    if (!checklistId || typeof checklistId !== "string") {
      throw new HttpsError("invalid-argument", "Missing parameter: checklistId");
    }

    const db = getFirestore();
    const snap = await db.collection("checklists").doc(checklistId).get();

    if (!snap.exists) {
      throw new HttpsError("not-found", "Checklist not found");
    }

    const data = snap.data() ?? {};
    const items: ChecklistItemLike[] = Array.isArray(data.items) ? data.items : [];

    const complete = isChecklistComplete(items);

    console.log(`[getChecklistCompleteness] OK: checklist ${checklistId} complete=${complete}`);
    return { checklistId, complete };
  }
);
