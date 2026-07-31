/**
 * Stato e (futuro) type di un item di checklist (Organizer core).
 *
 * Modulo condiviso, senza dipendenze da Firestore o da Cloud Functions,
 * riusato da tutte le Cloud Function di CRUD checklist del core Organizer
 * (`createChecklist`, `addChecklistItem`, `updateChecklistItem`,
 * `cloneChecklist`, `createChecklistFromTemplate`). Prima di questa
 * centralizzazione, `CHECKLIST_ITEM_STATUSES` era duplicata identicamente
 * in ciascuno di quei file.
 *
 * Il core Organizer non attribuisce nessun significato applicativo ai
 * valori di stato: sono semplicemente le quattro fasi previste dal modello
 * v1 (vedi process-organizer-core-newfeature.md).
 *
 * `CHECKLIST_ITEM_TYPES` e `isChecklistItemType` sono un prerequisito
 * strutturale per il discriminante `type` che verrà introdotto sulle
 * funzioni CRUD nelle Story successive di questa Epic: qui vengono solo
 * esposti, non ancora richiamati da nessuna Cloud Function.
 */

export const CHECKLIST_ITEM_STATUSES = ["Assegnare", "Da iniziare", "In corso", "Completata"] as const;
export type ChecklistItemStatus = typeof CHECKLIST_ITEM_STATUSES[number];

/**
 * Verifica se un valore è uno degli stati ammessi per un item di checklist.
 */
export function isChecklistItemStatus(value: unknown): value is ChecklistItemStatus {
  return typeof value === "string" &&
    (CHECKLIST_ITEM_STATUSES as readonly string[]).includes(value);
}

export const CHECKLIST_ITEM_TYPES = ["boolean", "generic", "numeric"] as const;
export type ChecklistItemType = typeof CHECKLIST_ITEM_TYPES[number];

/**
 * Verifica se un valore è uno dei type ammessi per un item di checklist.
 */
export function isChecklistItemType(value: unknown): value is ChecklistItemType {
  return typeof value === "string" &&
    (CHECKLIST_ITEM_TYPES as readonly string[]).includes(value);
}
