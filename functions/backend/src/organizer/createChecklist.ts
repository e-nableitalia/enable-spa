import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import crypto from "crypto";
import { logSecurityEvent } from "../security/securityLog";
import { getInvokeId } from "../utils/invoke";
import {
  CHECKLIST_ITEM_STATUSES,
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

/**
 * Normalizza un item iniziale ricevuto dal consumer in un `ChecklistItem`
 * completo. Un item iniziale deve essere un oggetto con `title`, `type` e,
 * opzionalmente, `quantity`/`notes` (lo shorthand a stringa semplice è
 * stato rimosso: da quando `type` è obbligatorio non poteva più produrre
 * un item valido - EA-143, finding F-6).
 *
 * `type` è obbligatorio ed è validato tramite il modulo condiviso
 * `checklistItemStatus`: non esiste un default, coerentemente con la
 * decisione umana su EA-121 (nessun trattamento legacy per item senza
 * type, non essendoci checklist reali già in produzione).
 *
 * Assegnatario, stato e flag di completamento NON sono accettati in input:
 * una checklist appena creata parte sempre con item non assegnati e nello
 * stato iniziale, coerentemente con il fatto che è una nuova istanza.
 */
function normalizeInitialItem(input: unknown): ChecklistItem {
  let title: unknown;
  let type: unknown;
  let quantity: unknown;
  let notes: unknown;

  if (typeof input === "object" && input !== null) {
    const raw = input as Record<string, unknown>;
    title = raw.title;
    type = raw.type;
    quantity = raw.quantity;
    notes = raw.notes;
  } else {
    throw new HttpsError("invalid-argument", "Each item must be a string or an object with a title");
  }

  if (typeof title !== "string" || title.trim() === "") {
    throw new HttpsError("invalid-argument", "Each item must have a non-empty title");
  }

  if (!isChecklistItemType(type)) {
    throw new HttpsError("invalid-argument", "Each item must have a valid type ('boolean' | 'generic' | 'numeric')");
  }

  if (quantity !== undefined && quantity !== null && typeof quantity !== "number") {
    throw new HttpsError("invalid-argument", "Item quantity must be a number");
  }

  if (notes !== undefined && typeof notes !== "string") {
    throw new HttpsError("invalid-argument", "Item notes must be a string");
  }

  return {
    id: crypto.randomUUID(),
    title,
    type,
    assignee: null,
    quantity: (quantity as number | undefined) ?? null,
    notes: (notes as string | undefined) ?? "",
    status: CHECKLIST_ITEM_STATUSES[0],
    completed: false,
  };
}

/**
 * Cloud Function callable per la creazione di una nuova istanza di
 * checklist nel core Organizer.
 *
 * Riceve dal consumer:
 * - `category`: identificatore di categoria opaco (il core non ne conosce
 *   il significato, es. per i device sarà il `devicetype`).
 * - `title`: titolo della checklist.
 * - `items` (opzionale): elenco di item iniziali con cui popolare la
 *   checklist; se omesso la checklist viene creata senza item. Ogni item
 *   richiede un `type` esplicito ('boolean' | 'generic' | 'numeric').
 *
 * Crea un documento in `checklists/{checklistId}` e restituisce il
 * `checklistId` generato al consumer.
 */
export const createChecklist = onCall(
  { region: REGION },
  async (request) => {
    const invokeId = getInvokeId(request);
    console.log(`[createChecklist] Invoke ID: ${invokeId} - Function called`);
    try {
      if (!request.auth) {
        console.log("[createChecklist] KO: Unauthenticated");
        throw new HttpsError("unauthenticated", "Authentication required");
      }
      const uid = request.auth.uid;

      const data = request.data ?? {};
      const { category, title, items } = data;

      if (!category || typeof category !== "string") {
        console.log("[createChecklist] KO: Missing or invalid category");
        throw new HttpsError("invalid-argument", "Missing or invalid category");
      }

      if (!title || typeof title !== "string") {
        console.log("[createChecklist] KO: Missing or invalid title");
        throw new HttpsError("invalid-argument", "Missing or invalid title");
      }

      if (items !== undefined && !Array.isArray(items)) {
        console.log("[createChecklist] KO: items must be an array");
        throw new HttpsError("invalid-argument", "items must be an array");
      }

      const normalizedItems: ChecklistItem[] = (items ?? []).map(normalizeInitialItem);

      const db = getFirestore();
      const checklistRef = db.collection("checklists").doc();

      console.log(`[createChecklist] Creating checklist document ${checklistRef.id}`);
      await checklistRef.set({
        category,
        title,
        items: normalizedItems,
        createdBy: uid,
        createdAt: FieldValue.serverTimestamp(),
      });

      await logSecurityEvent({
        type: "system",
        action: "create_checklist",
        outcome: "success",
        severity: "low",
        actor: { uid, email: request.auth.token?.email ?? undefined },
        context: { function: "createChecklist", invokeId, requestId: checklistRef.id },
      });

      console.log(`[createChecklist] OK: checklist ${checklistRef.id} created`);
      return { checklistId: checklistRef.id };
    } catch (error) {
      console.error("[createChecklist] KO:", error);
      await logSecurityEvent({
        type: "system",
        action: "create_checklist_failed",
        outcome: "failure",
        severity: "high",
        actor: { uid: request.auth?.uid, email: request.auth?.token?.email ?? undefined },
        context: { function: "createChecklist", invokeId },
      });

      if (error instanceof HttpsError) {
        throw error;
      }

      throw new HttpsError("internal", "Internal Server Error");
    }
  }
);
