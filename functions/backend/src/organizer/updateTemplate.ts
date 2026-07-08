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
 * Cloud Function callable per l'aggiornamento di un template di checklist
 * esistente nel core Organizer.
 *
 * Riceve dal consumer:
 * - `templateId`: identificatore del template da aggiornare.
 * - `title` (opzionale): nuovo titolo del template.
 * - `items` (opzionale): nuovo elenco di item con cui sostituire quelli
 *   esistenti.
 *
 * Almeno uno tra `title` e `items` deve essere presente. Aggiorna il
 * documento `templates/{templateId}` con i soli campi forniti e imposta
 * `updatedAt` a `FieldValue.serverTimestamp()`.
 */
export const updateTemplate = onCall(
  { region: REGION },
  async (request) => {
    const invokeId = getInvokeId(request);
    console.log(`[updateTemplate] Invoke ID: ${invokeId} - Function called`);
    try {
      if (!request.auth) {
        console.log("[updateTemplate] KO: Unauthenticated");
        throw new HttpsError("unauthenticated", "Authentication required");
      }

      const data = request.data ?? {};
      const { templateId, title, items } = data;

      if (!templateId || typeof templateId !== "string") {
        console.log("[updateTemplate] KO: Missing or invalid templateId");
        throw new HttpsError("invalid-argument", "Missing or invalid templateId");
      }

      const hasTitle = title !== undefined;
      const hasItems = items !== undefined;

      if (!hasTitle && !hasItems) {
        console.log("[updateTemplate] KO: No field to update provided");
        throw new HttpsError("invalid-argument", "At least one of title or items must be provided");
      }

      if (hasTitle && (typeof title !== "string" || !title.trim())) {
        console.log("[updateTemplate] KO: Missing or invalid title");
        throw new HttpsError("invalid-argument", "Missing or invalid title");
      }

      if (hasItems && !Array.isArray(items)) {
        console.log("[updateTemplate] KO: items must be an array");
        throw new HttpsError("invalid-argument", "items must be an array");
      }

      const updates: Record<string, unknown> = {};
      if (hasTitle) {
        updates.title = title;
      }
      if (hasItems) {
        updates.items = (items as unknown[]).map(normalizeTemplateItem);
      }

      const db = getFirestore();
      const templateRef = db.collection("templates").doc(templateId);
      const templateSnap = await templateRef.get();

      if (!templateSnap.exists) {
        console.log(`[updateTemplate] KO: template ${templateId} not found`);
        throw new HttpsError("not-found", "Template not found");
      }

      await templateRef.update({
        ...updates,
        updatedAt: FieldValue.serverTimestamp(),
      });

      console.log(`[updateTemplate] OK: template ${templateId} updated`);
      return { templateId };
    } catch (error) {
      console.error("[updateTemplate] KO:", error);

      if (error instanceof HttpsError) {
        throw error;
      }

      throw new HttpsError("internal", "Internal Server Error");
    }
  }
);
