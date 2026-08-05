import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { logSecurityEvent } from "../security/securityLog";
import { getInvokeId } from "../utils/invoke";
import {
  isChecklistItemStatus,
  ChecklistItemStatus,
  ChecklistItemType,
  isChecklistItemType,
} from "./checklistItemStatus";

const REGION = "europe-west1";

interface ChecklistItem {
  id: string;
  title: string;
  type: ChecklistItemType;
  assignee: string | null;
  quantity: number | null;
  notes: string;
  status: ChecklistItemStatus;
  completed: boolean;
}

// updateChecklistItem: aggiorna in modo parziale i campi (titolo, type,
// stato, assegnatario, quantità, note, completed) di un item esistente
// all'interno della lista items di una checklist. Aggiorna solo i campi
// esplicitamente presenti nella richiesta, lasciando invariati tutti gli
// altri campi dell'item. `type`, se fornito, è validato tramite il modulo
// condiviso checklistItemStatus (EA-122); se omesso, il type esistente
// dell'item resta invariato. `completed`, se fornito, deve essere un
// booleano (EA-145): rende per la prima volta raggiungibile da un
// percorso applicativo reale il ramo isBooleanItemComplete del gate di
// completezza type-aware (checklistCompleteness.ts, EA-127).
export const updateChecklistItem = onCall(
  { region: REGION },
  async (request) => {
    const invokeId = getInvokeId(request);
    console.log(`[updateChecklistItem] Invoke ID: ${invokeId} - Function called`);
    try {
      const uid = request.auth?.uid;
      if (!uid) {
        throw new HttpsError("unauthenticated", "User must be authenticated");
      }

      const { checklistId, itemId, title, type, status, assignee, quantity, notes, completed } = request.data as {
        checklistId?: string;
        itemId?: string;
        title?: string;
        type?: string;
        status?: string;
        assignee?: string | null;
        quantity?: number | null;
        notes?: string | null;
        completed?: boolean;
      };

      if (!checklistId || typeof checklistId !== "string") {
        throw new HttpsError("invalid-argument", "Missing checklistId");
      }
      if (!itemId || typeof itemId !== "string") {
        throw new HttpsError("invalid-argument", "Missing itemId");
      }

      const hasTitle = title !== undefined;
      const hasType = type !== undefined;
      const hasStatus = status !== undefined;
      const hasAssignee = assignee !== undefined;
      const hasQuantity = quantity !== undefined;
      const hasNotes = notes !== undefined;
      const hasCompleted = completed !== undefined;

      if (!hasTitle && !hasType && !hasStatus && !hasAssignee && !hasQuantity && !hasNotes && !hasCompleted) {
        throw new HttpsError("invalid-argument", "At least one field to update must be provided");
      }

      if (hasTitle && (typeof title !== "string" || !title.trim())) {
        throw new HttpsError("invalid-argument", "Item title must be a non-empty string");
      }
      if (hasType && !isChecklistItemType(type)) {
        throw new HttpsError("invalid-argument", "Each item must have a valid type ('boolean' | 'generic' | 'numeric')");
      }
      if (hasStatus && !isChecklistItemStatus(status)) {
        throw new HttpsError("invalid-argument", "Invalid item status");
      }
      if (hasAssignee && assignee !== null && typeof assignee !== "string") {
        throw new HttpsError("invalid-argument", "Item assignee must be a string");
      }
      if (hasQuantity && quantity !== null && typeof quantity !== "number") {
        throw new HttpsError("invalid-argument", "Item quantity must be a number");
      }
      if (hasNotes && notes !== null && typeof notes !== "string") {
        throw new HttpsError("invalid-argument", "Item notes must be a string");
      }
      if (hasCompleted && typeof completed !== "boolean") {
        throw new HttpsError("invalid-argument", "Item completed must be a boolean");
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

      const updatedItem: ChecklistItem = { ...items[itemIndex] };
      if (hasTitle) {
        updatedItem.title = title as string;
      }
      if (hasType) {
        updatedItem.type = type as ChecklistItemType;
      }
      if (hasStatus) {
        updatedItem.status = status as ChecklistItemStatus;
      }
      if (hasAssignee) {
        updatedItem.assignee = assignee ?? null;
      }
      if (hasQuantity) {
        updatedItem.quantity = quantity ?? null;
      }
      if (hasNotes) {
        updatedItem.notes = notes ?? "";
      }
      if (hasCompleted) {
        updatedItem.completed = completed as boolean;
      }

      const updatedItems = [...items];
      updatedItems[itemIndex] = updatedItem;

      await checklistRef.update({
        items: updatedItems,
        updatedAt: FieldValue.serverTimestamp(),
      });

      await logSecurityEvent({
        type: "system",
        action: "update_checklist_item",
        outcome: "success",
        severity: "low",
        actor: { uid, email: request.auth?.token?.email ?? undefined },
        context: { function: "updateChecklistItem", invokeId, requestId: checklistId },
      });

      console.log(`[updateChecklistItem] OK: item ${itemId} of checklist ${checklistId} updated by ${uid}`);
      return { success: true };
    } catch (error) {
      console.error("[updateChecklistItem] KO:", error);
      await logSecurityEvent({
        type: "system",
        action: "update_checklist_item_failed",
        outcome: "failure",
        severity: "high",
        actor: { uid: request.auth?.uid, email: request.auth?.token?.email ?? undefined },
        context: { function: "updateChecklistItem", invokeId, requestId: request.data?.checklistId },
      });
      if (error instanceof HttpsError) throw error;
      throw new HttpsError("internal", "Internal Server Error");
    }
  }
);
