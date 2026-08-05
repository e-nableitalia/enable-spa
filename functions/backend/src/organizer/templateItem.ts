import { HttpsError } from "firebase-functions/v2/https";
import { ChecklistItemType, isChecklistItemType } from "./checklistItemStatus";

export interface TemplateItem {
  title: string;
  type: ChecklistItemType;
  quantity: number | null;
}

/**
 * Normalizza un item di template ricevuto dal consumer in un `TemplateItem`.
 * Un item deve essere un oggetto con `title`, `type` e, opzionalmente,
 * `quantity`; `type` è obbligatorio ed è validato tramite il modulo
 * condiviso `checklistItemStatus`.
 *
 * Modulo condiviso, riusato identicamente da `createTemplate` e
 * `updateTemplate` (prima di EA-144 la funzione era duplicata in entrambi i
 * file). Lo shorthand a stringa (solo `title`, senza `type`) è stato
 * rimosso in EA-144: dopo l'introduzione del `type` obbligatorio (EA-125)
 * quel ramo produceva sempre `type: undefined`, fallendo sempre la
 * validazione (finding F-7 in docs/FINDINGS.md).
 *
 * Un template è un catalogo di riferimento, non un'istanza: gli item non
 * hanno stato, assegnatario né flag di completamento.
 */
export function normalizeTemplateItem(input: unknown): TemplateItem {
  let title: unknown;
  let type: unknown;
  let quantity: unknown;

  if (typeof input === "object" && input !== null) {
    const raw = input as Record<string, unknown>;
    title = raw.title;
    type = raw.type;
    quantity = raw.quantity;
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

  return {
    title,
    type,
    quantity: (quantity as number | undefined) ?? null,
  };
}
