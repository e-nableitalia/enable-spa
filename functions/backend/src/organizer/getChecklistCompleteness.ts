import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore } from "firebase-admin/firestore";
import { logSecurityEvent } from "../security/securityLog";
import { getInvokeId } from "../utils/invoke";
import { isChecklistComplete, ChecklistItemLike } from "./checklistCompleteness";
import { resolveChecklistItems } from "./resolveChecklistItems";

const REGION = "europe-west1";

/**
 * getChecklistCompleteness: espone al consumer lo stato di completezza di
 * una checklist esistente (gate di completezza, Epic EA-3).
 *
 * Confine architetturale: questa funzione legge la checklist e restituisce
 * l'esito del gate di completezza (`complete: boolean`) — non blocca
 * nulla, non esegue transizioni di stato, non modifica il documento. Il
 * consumer decide cosa fare dell'esito.
 *
 * Da EA-137, `checklists/{id}.items` è un array di soli `itemId`: prima di
 * applicare il gate occorre risolvere i documenti reali in
 * `checklistItems` (EA-138), con lo stesso meccanismo di lettura batch
 * usato da `getChecklist`.
 */
export const getChecklistCompleteness = onCall(
  { region: REGION },
  async (request) => {
    const invokeId = getInvokeId(request);
    console.log(`[getChecklistCompleteness] Invoke ID: ${invokeId} - Function called`);

    try {
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
      const itemIds: string[] = Array.isArray(data.items) ? data.items : [];
      const items = (await resolveChecklistItems(db, itemIds)) as unknown as ChecklistItemLike[];

      const complete = isChecklistComplete(items);

      await logSecurityEvent({
        type: "system",
        action: "get_checklist_completeness",
        outcome: "success",
        severity: "low",
        actor: { uid, email: request.auth?.token?.email ?? undefined },
        context: { function: "getChecklistCompleteness", invokeId, requestId: checklistId },
      });

      console.log(`[getChecklistCompleteness] OK: checklist ${checklistId} complete=${complete}`);
      return { checklistId, complete };
    } catch (error) {
      console.error("[getChecklistCompleteness] KO:", error);
      await logSecurityEvent({
        type: "system",
        action: "get_checklist_completeness_failed",
        outcome: "failure",
        severity: "high",
        actor: { uid: request.auth?.uid, email: request.auth?.token?.email ?? undefined },
        context: { function: "getChecklistCompleteness", invokeId, requestId: request.data?.checklistId },
      });
      if (error instanceof HttpsError) throw error;
      throw new HttpsError("internal", "Internal Server Error");
    }
  }
);
