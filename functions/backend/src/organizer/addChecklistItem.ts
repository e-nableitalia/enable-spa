import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import crypto from "crypto";
import { logSecurityEvent } from "../security/securityLog";
import { getInvokeId } from "../utils/invoke";

const REGION = "europe-west1";

/**
 * Stato di un item di checklist. Vedi createChecklist.ts per la nota sul
 * significato (assente) che il core Organizer attribuisce a questi valori.
 */
const CHECKLIST_ITEM_STATUSES = ["Assegnare", "Da iniziare", "In corso", "Completata"] as const;
type ChecklistItemStatus = typeof CHECKLIST_ITEM_STATUSES[number];

interface ChecklistItem {
  id: string;
  title: string;
  assignee: string | null;
  quantity: number | null;
  notes: string;
  status: ChecklistItemStatus;
  completed: boolean;
}

// addChecklistItem: aggiunge un nuovo item alla lista items di un'istanza
// checklist esistente, con stato iniziale "Assegnare" e flag di
// completamento a false. Restituisce l'itemId generato al consumer.
export const addChecklistItem = onCall(
  { region: REGION },
  async (request) => {
    const invokeId = getInvokeId(request);
    console.log(`[addChecklistItem] Invoke ID: ${invokeId} - Function called`);
    try {
      const uid = request.auth?.uid;
      if (!uid) {
        throw new HttpsError("unauthenticated", "User must be authenticated");
      }

      const { checklistId, title, assignee, quantity, notes } = request.data as {
        checklistId?: string;
        title?: string;
        assignee?: string;
        quantity?: number;
        notes?: string;
      };

      if (!checklistId || typeof checklistId !== "string") {
        throw new HttpsError("invalid-argument", "Missing checklistId");
      }
      if (!title || typeof title !== "string" || !title.trim()) {
        throw new HttpsError("invalid-argument", "Missing title");
      }
      if (assignee !== undefined && assignee !== null && typeof assignee !== "string") {
        throw new HttpsError("invalid-argument", "Item assignee must be a string");
      }
      if (quantity !== undefined && quantity !== null && typeof quantity !== "number") {
        throw new HttpsError("invalid-argument", "Item quantity must be a number");
      }
      if (notes !== undefined && notes !== null && typeof notes !== "string") {
        throw new HttpsError("invalid-argument", "Item notes must be a string");
      }

      const db = getFirestore();
      const checklistRef = db.collection("checklists").doc(checklistId);
      const checklistSnap = await checklistRef.get();

      if (!checklistSnap.exists) {
        throw new HttpsError("not-found", "Checklist not found");
      }

      const newItem: ChecklistItem = {
        id: crypto.randomUUID(),
        title,
        assignee: assignee ?? null,
        quantity: quantity ?? null,
        notes: notes ?? "",
        status: CHECKLIST_ITEM_STATUSES[0],
        completed: false,
      };

      await checklistRef.update({
        items: FieldValue.arrayUnion(newItem),
        updatedAt: FieldValue.serverTimestamp(),
      });

      await logSecurityEvent({
        type: "system",
        action: "add_checklist_item",
        outcome: "success",
        severity: "low",
        actor: { uid, email: request.auth?.token?.email ?? undefined },
        context: { function: "addChecklistItem", invokeId, requestId: checklistId },
      });

      console.log(`[addChecklistItem] OK: item ${newItem.id} added to checklist ${checklistId} by ${uid}`);
      return { itemId: newItem.id };
    } catch (error) {
      console.error("[addChecklistItem] KO:", error);
      await logSecurityEvent({
        type: "system",
        action: "add_checklist_item_failed",
        outcome: "failure",
        severity: "high",
        actor: { uid: request.auth?.uid, email: request.auth?.token?.email ?? undefined },
        context: { function: "addChecklistItem", invokeId, requestId: request.data?.checklistId },
      });
      if (error instanceof HttpsError) throw error;
      throw new HttpsError("internal", "Internal Server Error");
    }
  }
);
