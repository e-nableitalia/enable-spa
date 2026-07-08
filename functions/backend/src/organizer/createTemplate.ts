import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { getInvokeId } from "../utils/invoke";

const REGION = "europe-west1";

interface TemplateItem {
  title: string;
  quantity: number | null;
}

/**
 * Normalizza un item di template ricevuto dal consumer in un `TemplateItem`.
 * Un item può essere una semplice stringa (il titolo) o un oggetto con
 * `title` e, opzionalmente, `quantity`.
 *
 * Un template è un catalogo di riferimento, non un'istanza: gli item non
 * hanno stato, assegnatario né flag di completamento.
 */
function normalizeTemplateItem(input: unknown): TemplateItem {
  let title: unknown;
  let quantity: unknown;

  if (typeof input === "string") {
    title = input;
  } else if (typeof input === "object" && input !== null) {
    const raw = input as Record<string, unknown>;
    title = raw.title;
    quantity = raw.quantity;
  } else {
    throw new HttpsError("invalid-argument", "Each item must be a string or an object with a title");
  }

  if (typeof title !== "string" || title.trim() === "") {
    throw new HttpsError("invalid-argument", "Each item must have a non-empty title");
  }

  if (quantity !== undefined && quantity !== null && typeof quantity !== "number") {
    throw new HttpsError("invalid-argument", "Item quantity must be a number");
  }

  return {
    title,
    quantity: (quantity as number | undefined) ?? null,
  };
}

/**
 * Cloud Function callable per la creazione di un nuovo template di
 * checklist nel core Organizer.
 *
 * Riceve dal consumer:
 * - `category`: identificatore di categoria opaco (il core non ne conosce
 *   il significato, es. per i device sarà il `devicetype`).
 * - `title`: titolo del template.
 * - `items` (opzionale): elenco di item con cui popolare il template; se
 *   omesso il template viene creato senza item.
 *
 * Crea un documento in `templates/{templateId}` e restituisce il
 * `templateId` generato al consumer.
 */
export const createTemplate = onCall(
  { region: REGION },
  async (request) => {
    const invokeId = getInvokeId(request);
    console.log(`[createTemplate] Invoke ID: ${invokeId} - Function called`);
    try {
      if (!request.auth) {
        console.log("[createTemplate] KO: Unauthenticated");
        throw new HttpsError("unauthenticated", "Authentication required");
      }

      const data = request.data ?? {};
      const { category, title, items } = data;

      if (!category || typeof category !== "string") {
        console.log("[createTemplate] KO: Missing or invalid category");
        throw new HttpsError("invalid-argument", "Missing or invalid category");
      }

      if (!title || typeof title !== "string") {
        console.log("[createTemplate] KO: Missing or invalid title");
        throw new HttpsError("invalid-argument", "Missing or invalid title");
      }

      if (items !== undefined && !Array.isArray(items)) {
        console.log("[createTemplate] KO: items must be an array");
        throw new HttpsError("invalid-argument", "items must be an array");
      }

      const normalizedItems: TemplateItem[] = (items ?? []).map(normalizeTemplateItem);

      const db = getFirestore();
      const templateRef = db.collection("templates").doc();

      console.log(`[createTemplate] Creating template document ${templateRef.id}`);
      await templateRef.set({
        category,
        title,
        items: normalizedItems,
        createdAt: FieldValue.serverTimestamp(),
      });

      console.log(`[createTemplate] OK: template ${templateRef.id} created`);
      return { templateId: templateRef.id };
    } catch (error) {
      console.error("[createTemplate] KO:", error);

      if (error instanceof HttpsError) {
        throw error;
      }

      throw new HttpsError("internal", "Internal Server Error");
    }
  }
);
