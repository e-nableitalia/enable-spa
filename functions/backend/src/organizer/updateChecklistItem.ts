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
import { isChecklistItemComplete, ChecklistItemLike } from "./checklistCompleteness";

const REGION = "europe-west1";

// updateChecklistItem: aggiorna in modo parziale i campi (titolo, type,
// stato, assegnatario, quantità, note, completed) del documento
// `checklistItems/{itemId}` corrispondente (EA-137: non più un elemento
// dell'array embedded `checklists/{id}.items`, ma un documento distinto).
// Aggiorna solo i campi esplicitamente presenti nella richiesta, lasciando
// invariati tutti gli altri campi dell'item (incluso `creationDate`,
// `dueDate`). `type`, se fornito, è validato tramite il modulo condiviso
// checklistItemStatus (EA-122); se omesso, il type esistente dell'item
// resta invariato. `completed`, se fornito, deve essere un booleano
// (EA-145): rende raggiungibile da un percorso applicativo reale il ramo
// isBooleanItemComplete del gate di completezza type-aware
// (checklistCompleteness.ts, EA-127).
//
// `completionDate` non è un campo accettato in input dal consumer: è
// valorizzato automaticamente da questa stessa funzione (EA-137) quando
// l'esito del gate di completezza (`isChecklistItemComplete`,
// `checklistCompleteness.ts`) transita da non completo a completo per
// effetto dei campi aggiornati in questa chiamata, incluso `completed`
// quando fornito (EA-145 è mergiata prima di questa Story: il ramo
// `boolean` del gate è quindi già raggiungibile). Se l'item era già
// completo prima della chiamata, `completionDate` resta invariato (non
// viene ri-valorizzato a ogni update mentre l'item resta completo).
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

      const itemRef = db.collection("checklistItems").doc(itemId);
      const itemSnap = await itemRef.get();

      if (!itemSnap.exists || itemSnap.data()?.checklistId !== checklistId) {
        throw new HttpsError("not-found", "Checklist item not found");
      }

      const currentItem = itemSnap.data() ?? {};
      const beforeState: ChecklistItemLike = {
        type: currentItem.type,
        assignee: currentItem.assignee,
        quantity: currentItem.quantity,
        status: currentItem.status,
        completed: currentItem.completed,
      };
      const afterState: ChecklistItemLike = {
        type: hasType ? (type as ChecklistItemType) : beforeState.type,
        assignee: hasAssignee ? (assignee ?? null) : beforeState.assignee,
        quantity: hasQuantity ? (quantity ?? null) : beforeState.quantity,
        status: hasStatus ? (status as ChecklistItemStatus) : beforeState.status,
        completed: hasCompleted ? (completed as boolean) : beforeState.completed,
      };

      const updatePayload: Record<string, unknown> = {
        updatedAt: FieldValue.serverTimestamp(),
      };
      if (hasTitle) {
        updatePayload.title = title;
      }
      if (hasType) {
        updatePayload.type = type;
      }
      if (hasStatus) {
        updatePayload.status = status;
      }
      if (hasAssignee) {
        updatePayload.assignee = assignee ?? null;
      }
      if (hasQuantity) {
        updatePayload.quantity = quantity ?? null;
      }
      if (hasNotes) {
        updatePayload.notes = notes ?? "";
      }
      if (!isChecklistItemComplete(beforeState) && isChecklistItemComplete(afterState)) {
        updatePayload.completionDate = FieldValue.serverTimestamp();
      }
      if (hasCompleted) {
        updatePayload.completed = completed as boolean;
      }

      await itemRef.update(updatePayload);

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
