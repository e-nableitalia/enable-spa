import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { logSecurityEvent } from "../security/securityLog";
import { getInvokeId } from "../utils/invoke";

const REGION = "europe-west1";

interface ChecklistItem {
  id: string;
  title: string;
  assignee: string | null;
  quantity: number | null;
  notes: string;
  status: string;
  completed: boolean;
}

// removeChecklistItem: rimuove un item dalla lista items di un'istanza
// checklist esistente, lasciando invariati tutti gli altri item della stessa
// checklist.
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

      const data = checklistSnap.data() ?? {};
      const items: ChecklistItem[] = Array.isArray(data.items) ? data.items : [];
      const itemIndex = items.findIndex((item) => item.id === itemId);

      if (itemIndex === -1) {
        throw new HttpsError("not-found", "Checklist item not found");
      }

      const updatedItems = items.filter((item) => item.id !== itemId);

      await checklistRef.update({
        items: updatedItems,
        updatedAt: FieldValue.serverTimestamp(),
      });

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
