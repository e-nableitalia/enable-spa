import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { logSecurityEvent } from "../security/securityLog";
import { getInvokeId } from "../utils/invoke";
import {
  CHECKLIST_ITEM_STATUSES,
  ChecklistItemStatus,
  ChecklistItemType,
  isChecklistItemType,
} from "./checklistItemStatus";

const REGION = "europe-west1";

interface NormalizedInitialItem {
  title: string;
  type: ChecklistItemType;
  assignee: string | null;
  quantity: number | null;
  notes: string;
  status: ChecklistItemStatus;
  completed: boolean;
}

interface ChecklistOrigin {
  type: string;
  id: string;
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
 * stato iniziale, coerentemente con il fatto che è una nuova istanza. Non
 * include ancora `id`/`checklistId`/`category`: valorizzati dal chiamante
 * al momento della scrittura del documento `checklistItems` (EA-137, la
 * riscrittura in collection di primo livello sostituisce l'array embedded).
 */
function normalizeInitialItem(input: unknown): NormalizedInitialItem {
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
 * Normalizza il campo opzionale `origin` (navigabilità bidirezionale
 * checklist → entità proprietaria, es. `{ type: "deviceRequest", id:
 * "<requestId>" }`). Restituisce `undefined` se il consumer non lo
 * fornisce, in modo che il chiamante possa omettere del tutto la chiave dal
 * documento invece di scriverla valorizzata a `undefined`.
 */
function normalizeOrigin(input: unknown): ChecklistOrigin | undefined {
  if (input === undefined) {
    return undefined;
  }

  if (typeof input !== "object" || input === null) {
    throw new HttpsError("invalid-argument", "origin must be an object with type and id");
  }

  const raw = input as Record<string, unknown>;
  if (
    typeof raw.type !== "string" || raw.type.trim() === "" ||
    typeof raw.id !== "string" || raw.id.trim() === ""
  ) {
    throw new HttpsError("invalid-argument", "origin must be an object with type and id");
  }

  return { type: raw.type, id: raw.id };
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
 * - `origin` (opzionale): `{ type, id }` dell'entità proprietaria della
 *   checklist (es. una `deviceRequest`), per navigabilità bidirezionale
 *   (EA-137). Se omesso, il documento non contiene il campo.
 *
 * Crea un documento in `checklists/{checklistId}` — il cui campo `items` è
 * ora il solo elenco degli `itemId` — e un documento distinto in
 * `checklistItems/{itemId}` per ciascun item iniziale, con `checklistId` e
 * `category` denormalizzata dalla checklist padre (EA-137: gli item
 * smettono di essere un array embedded). Restituisce il `checklistId`
 * generato al consumer.
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
      const { category, title, items, origin } = data;

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

      const normalizedItems: NormalizedInitialItem[] = (items ?? []).map(normalizeInitialItem);
      const normalizedOrigin = normalizeOrigin(origin);

      const db = getFirestore();
      const checklistRef = db.collection("checklists").doc();
      const itemRefs = normalizedItems.map(() => db.collection("checklistItems").doc());

      console.log(`[createChecklist] Creating checklist document ${checklistRef.id}`);
      const batch = db.batch();
      batch.set(checklistRef, {
        category,
        title,
        items: itemRefs.map((itemRef) => itemRef.id),
        createdBy: uid,
        createdAt: FieldValue.serverTimestamp(),
        ...(normalizedOrigin ? { origin: normalizedOrigin } : {}),
      });

      itemRefs.forEach((itemRef, index) => {
        batch.set(itemRef, {
          id: itemRef.id,
          checklistId: checklistRef.id,
          category,
          ...normalizedItems[index],
          creationDate: FieldValue.serverTimestamp(),
          dueDate: null,
          completionDate: null,
        });
      });

      await batch.commit();

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
