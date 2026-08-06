import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { logSecurityEvent } from "../security/securityLog";
import { getInvokeId } from "../utils/invoke";
import {
  CHECKLIST_ITEM_STATUSES,
  isChecklistItemType,
} from "./checklistItemStatus";

const REGION = "europe-west1";

// addChecklistItem: crea un nuovo documento in `checklistItems`, con
// `checklistId`/`category` (denormalizzata dalla checklist padre), stato
// iniziale "Assegnare" e flag di completamento a false, e ne aggiunge
// l'itemId all'array `items` della checklist padre (EA-137: gli item
// smettono di essere un array embedded aggiornato via arrayUnion). Richiede
// un `type` esplicito ('boolean' | 'generic' | 'numeric'), coerentemente
// con createChecklist (EA-123): nessun default. Restituisce l'itemId
// generato al consumer.
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

      const { checklistId, title, type, assignee, quantity, notes } = request.data as {
        checklistId?: string;
        title?: string;
        type?: string;
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
      if (!isChecklistItemType(type)) {
        throw new HttpsError("invalid-argument", "Each item must have a valid type ('boolean' | 'generic' | 'numeric')");
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

      const category = checklistSnap.data()?.category;
      const itemRef = db.collection("checklistItems").doc();

      const batch = db.batch();
      batch.set(itemRef, {
        id: itemRef.id,
        checklistId,
        category,
        title,
        type,
        assignee: assignee ?? null,
        quantity: quantity ?? null,
        notes: notes ?? "",
        status: CHECKLIST_ITEM_STATUSES[0],
        completed: false,
        creationDate: FieldValue.serverTimestamp(),
        dueDate: null,
        completionDate: null,
      });
      batch.update(checklistRef, {
        items: FieldValue.arrayUnion(itemRef.id),
        updatedAt: FieldValue.serverTimestamp(),
      });

      await batch.commit();

      await logSecurityEvent({
        type: "system",
        action: "add_checklist_item",
        outcome: "success",
        severity: "low",
        actor: { uid, email: request.auth?.token?.email ?? undefined },
        context: { function: "addChecklistItem", invokeId, requestId: checklistId },
      });

      console.log(`[addChecklistItem] OK: item ${itemRef.id} added to checklist ${checklistId} by ${uid}`);
      return { itemId: itemRef.id };
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
