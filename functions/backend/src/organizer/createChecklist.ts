import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import crypto from "crypto";
import { getInvokeId } from "../utils/invoke";

const REGION = "europe-west1";

/**
 * Stato di un item di checklist. Il core Organizer non attribuisce nessun
 * significato applicativo a questi valori: sono semplicemente le quattro
 * fasi previste dal modello v1 (vedi process-organizer-core-newfeature.md).
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

/**
 * Normalizza un item iniziale ricevuto dal consumer in un `ChecklistItem`
 * completo. Un item iniziale può essere una semplice stringa (il titolo) o
 * un oggetto con `title` e, opzionalmente, `quantity`/`notes`.
 *
 * Assegnatario, stato e flag di completamento NON sono accettati in input:
 * una checklist appena creata parte sempre con item non assegnati e nello
 * stato iniziale, coerentemente con il fatto che è una nuova istanza.
 */
function normalizeInitialItem(input: unknown): ChecklistItem {
  let title: unknown;
  let quantity: unknown;
  let notes: unknown;

  if (typeof input === "string") {
    title = input;
  } else if (typeof input === "object" && input !== null) {
    const raw = input as Record<string, unknown>;
    title = raw.title;
    quantity = raw.quantity;
    notes = raw.notes;
  } else {
    throw new HttpsError("invalid-argument", "Each item must be a string or an object with a title");
  }

  if (typeof title !== "string" || title.trim() === "") {
    throw new HttpsError("invalid-argument", "Each item must have a non-empty title");
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
 *   checklist; se omesso la checklist viene creata senza item.
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
        createdAt: FieldValue.serverTimestamp(),
      });

      console.log(`[createChecklist] OK: checklist ${checklistRef.id} created`);
      return { checklistId: checklistRef.id };
    } catch (error) {
      console.error("[createChecklist] KO:", error);

      if (error instanceof HttpsError) {
        throw error;
      }

      throw new HttpsError("internal", "Internal Server Error");
    }
  }
);
