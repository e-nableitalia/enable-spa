import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { logSecurityEvent } from "../security/securityLog";
import { getInvokeId } from "../utils/invoke";

const REGION = "europe-west1";

// removeChecklistItem: elimina il documento `checklistItems/{itemId}`
// corrispondente e rimuove il suo itemId dall'array `items` della checklist
// padre (EA-137: gli item smettono di essere un array embedded, l'elemento
// da rimuovere è ora un documento distinto in `checklistItems`), lasciando
// invariati tutti gli altri item della stessa checklist.
export const removeChecklistItem = onCall(
  { region: REGION },
  async (request) => {
    const invokeId = getInvokeId(request);
    console.log(`[removeChecklistItem] Invoke ID: ${invokeId} - Function called`);
    try {
      const uid = request.auth?.uid;
      if (!uid) {
        throw new HttpsError("unauthenticated", "User must be authenticated");
      }

      const { checklistId, itemId } = request.data as {
        checklistId?: string;
        itemId?: string;
      };

      if (!checklistId || typeof checklistId !== "string") {
        throw new HttpsError("invalid-argument", "Missing checklistId");
      }
      if (!itemId || typeof itemId !== "string") {
        throw new HttpsError("invalid-argument", "Missing itemId");
      }

      const db = getFirestore();
      const checklistRef = db.collection("checklists").doc(checklistId);
      const checklistSnap = await checklistRef.get();

      if (!checklistSnap.exists) {
        throw new HttpsError("not-found", "Checklist not found");
      }

      const itemRef = db.collection("checklistItems").doc(itemId);
      const itemSnap = await itemRef.get();

      if (!itemSnap.exists || itemSnap.data()?.checklistId !== checklistId) {
        throw new HttpsError("not-found", "Checklist item not found");
      }

      const batch = db.batch();
      batch.delete(itemRef);
      batch.update(checklistRef, {
        items: FieldValue.arrayRemove(itemId),
        updatedAt: FieldValue.serverTimestamp(),
      });

      await batch.commit();

      await logSecurityEvent({
        type: "system",
        action: "remove_checklist_item",
        outcome: "success",
        severity: "low",
        actor: { uid, email: request.auth?.token?.email ?? undefined },
        context: { function: "removeChecklistItem", invokeId, requestId: checklistId },
      });

      console.log(`[removeChecklistItem] OK: item ${itemId} removed from checklist ${checklistId} by ${uid}`);
      return { success: true };
    } catch (error) {
      console.error("[removeChecklistItem] KO:", error);
      await logSecurityEvent({
        type: "system",
        action: "remove_checklist_item_failed",
        outcome: "failure",
        severity: "high",
        actor: { uid: request.auth?.uid, email: request.auth?.token?.email ?? undefined },
        context: { function: "removeChecklistItem", invokeId, requestId: request.data?.checklistId },
      });
      if (error instanceof HttpsError) throw error;
      throw new HttpsError("internal", "Internal Server Error");
    }
  }
);
