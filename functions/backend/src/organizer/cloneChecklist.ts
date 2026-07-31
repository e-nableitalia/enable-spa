import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import crypto from "crypto";
import { logSecurityEvent } from "../security/securityLog";
import { getInvokeId } from "../utils/invoke";
import { CHECKLIST_ITEM_STATUSES, ChecklistItemStatus } from "./checklistItemStatus";

const REGION = "europe-west1";

interface ChecklistItem {
  id: string;
  title: string;
  assignee: string | null;
  quantity: number | null;
  notes: string;
  status: ChecklistItemStatus;
  completed: boolean;
}

interface SourceChecklistItem {
  title: unknown;
  quantity: unknown;
}

/**
 * Clona un item di un'istanza sorgente in un nuovo `ChecklistItem` per la
 * nuova istanza.
 *
 * Logica di clonazione (Epic EA-3, riferimento `useWorkshopAsTemplate` nel
 * mockup allegato): titolo e quantità vengono copiati dalla sorgente,
 * mentre stato, assegnatario e flag di completamento vengono sempre
 * azzerati, indipendentemente dallo stato di avanzamento che l'item aveva
 * nella sorgente — si riparte sempre da zero.
 */
function cloneSourceItem(sourceItem: SourceChecklistItem): ChecklistItem {
  const title = typeof sourceItem?.title === "string" ? sourceItem.title : "";
  const quantity = typeof sourceItem?.quantity === "number" ? sourceItem.quantity : null;

  return {
    id: crypto.randomUUID(),
    title,
    assignee: null,
    quantity,
    notes: "",
    status: CHECKLIST_ITEM_STATUSES[0],
    completed: false,
  };
}

/**
 * Cloud Function callable per la clonazione di una nuova checklist a
 * partire da un'istanza di checklist già esistente, nel core Organizer.
 *
 * Distinta dall'istanziazione da template (`createChecklistFromTemplate`):
 * qui si parte da un'istanza reale, in qualsiasi stato di avanzamento
 * (anche completata), non da un catalogo di riferimento. Caso d'uso
 * tipico: "ripeti questa checklist per una nuova occasione, ripartendo da
 * zero".
 *
 * Riceve dal consumer:
 * - `sourceChecklistId`: identificatore della checklist sorgente da cui
 *   clonare.
 * - `title`: titolo della nuova istanza di checklist.
 * - `category` (opzionale): identificatore di categoria opaco con cui
 *   sovrascrivere quello della sorgente. Se omesso, la categoria è
 *   ereditata dalla sorgente.
 *
 * Copia gli item della sorgente nella nuova istanza (titolo e quantità
 * copiati, stato impostato ad 'Assegnare', assegnatario a null e flag di
 * completamento a false su ciascun item clonato, indipendentemente dallo
 * stato che avevano nella sorgente). Registra `clonedFrom:
 * <sourceChecklistId>` come riferimento storico, non come dipendenza viva:
 * la sorgente può essere modificata o eliminata in seguito senza che la
 * nuova istanza ne risenta.
 *
 * Crea un documento in `checklists/{checklistId}` e restituisce il
 * `checklistId` generato al consumer.
 */
export const cloneChecklist = onCall(
  { region: REGION },
  async (request) => {
    const invokeId = getInvokeId(request);
    console.log(`[cloneChecklist] Invoke ID: ${invokeId} - Function called`);
    try {
      if (!request.auth) {
        console.log("[cloneChecklist] KO: Unauthenticated");
        throw new HttpsError("unauthenticated", "Authentication required");
      }
      const uid = request.auth.uid;

      const data = request.data ?? {};
      const { sourceChecklistId, title, category } = data;

      if (!sourceChecklistId || typeof sourceChecklistId !== "string") {
        console.log("[cloneChecklist] KO: Missing or invalid sourceChecklistId");
        throw new HttpsError("invalid-argument", "Missing or invalid sourceChecklistId");
      }

      if (!title || typeof title !== "string") {
        console.log("[cloneChecklist] KO: Missing or invalid title");
        throw new HttpsError("invalid-argument", "Missing or invalid title");
      }

      if (category !== undefined && category !== null && typeof category !== "string") {
        console.log("[cloneChecklist] KO: category must be a string");
        throw new HttpsError("invalid-argument", "category must be a string");
      }

      const db = getFirestore();
      const sourceRef = db.collection("checklists").doc(sourceChecklistId);
      const sourceSnap = await sourceRef.get();

      if (!sourceSnap.exists) {
        console.log(`[cloneChecklist] KO: source checklist ${sourceChecklistId} not found`);
        throw new HttpsError("not-found", "Source checklist not found");
      }

      const sourceData = sourceSnap.data() ?? {};
      const sourceItems: SourceChecklistItem[] = Array.isArray(sourceData.items) ? sourceData.items : [];
      const clonedItems: ChecklistItem[] = sourceItems.map(cloneSourceItem);

      const resolvedCategory = (category as string | undefined) ?? sourceData.category;

      const checklistRef = db.collection("checklists").doc();

      console.log(
        `[cloneChecklist] Creating checklist document ${checklistRef.id} cloned from ${sourceChecklistId}`
      );
      await checklistRef.set({
        category: resolvedCategory,
        title,
        items: clonedItems,
        clonedFrom: sourceChecklistId,
        createdBy: uid,
        createdAt: FieldValue.serverTimestamp(),
      });

      await logSecurityEvent({
        type: "system",
        action: "clone_checklist",
        outcome: "success",
        severity: "low",
        actor: { uid, email: request.auth.token?.email ?? undefined },
        context: { function: "cloneChecklist", invokeId, requestId: checklistRef.id },
      });

      console.log(
        `[cloneChecklist] OK: checklist ${checklistRef.id} created cloned from ${sourceChecklistId}`
      );
      return { checklistId: checklistRef.id };
    } catch (error) {
      console.error("[cloneChecklist] KO:", error);
      await logSecurityEvent({
        type: "system",
        action: "clone_checklist_failed",
        outcome: "failure",
        severity: "high",
        actor: { uid: request.auth?.uid, email: request.auth?.token?.email ?? undefined },
        context: { function: "cloneChecklist", invokeId },
      });

      if (error instanceof HttpsError) {
        throw error;
      }

      throw new HttpsError("internal", "Internal Server Error");
    }
  }
);
