/**
 * Gate di completezza checklist (Organizer core).
 *
 * Utility TypeScript pura, senza dipendenze da Firestore o da Cloud
 * Functions: riceve item di checklist e restituisce lo stato di
 * completezza, senza eseguire nessuna azione. Coerentemente con il
 * confine architetturale dell'Epic EA-3 (core vs consumer): il core si
 * limita a esporre lo stato, il consumer decide cosa fare dell'esito
 * (es. sbloccare una transizione di stato altrove).
 *
 * Definizione di completezza di un item (EA-127): il calcolo dipende dal
 * `type` dell'item ('boolean' | 'generic' | 'numeric', vedi
 * `checklistItemStatus.ts`), oltre all'assegnatario sempre richiesto:
 * - l'assegnatario è valorizzato (non null, non stringa vuota/whitespace)
 *   in tutti i casi;
 * - `boolean`: completo se `completed === true`, indipendentemente da
 *   `status` e `quantity`;
 * - `generic`: completo se `status === 'Completata'` (corregge il bug per
 *   cui qualunque stato diverso da "Assegnare", incluso "Da iniziare" e
 *   "In corso", risultava completo);
 * - `numeric`: come `generic`, più la quantità valorizzata (non `null`,
 *   non `undefined`);
 * - `type` assente o non riconosciuto (item legacy pre-EA-123): trattato
 *   come `generic`, l'unico calcolo esprimibile con i soli campi
 *   storicamente disponibili (`status`, senza `completed`).
 *
 * Una checklist è completa quando TUTTI i suoi item lo sono. Una
 * checklist senza item è considerata completa (nessun item incompleto).
 */

/**
 * Forma minima di un item di checklist accettata dal gate. Volutamente
 * meno vincolata dell'interfaccia `ChecklistItem` usata dalle Cloud
 * Functions di CRUD, in modo da restare una utility riusabile e
 * indipendente da come il consumer rappresenta i propri item.
 */
export interface ChecklistItemLike {
  type?: string | null;
  assignee?: string | null;
  quantity?: number | null;
  status: string;
  completed?: boolean | null;
}

const COMPLETED_STATUS = "Completata";

/**
 * Verifica se l'assegnatario di un item è valorizzato.
 */
function hasAssignee(item: ChecklistItemLike): boolean {
  return typeof item.assignee === "string" && item.assignee.trim().length > 0;
}

/**
 * Verifica se la quantità di un item è valorizzata (non `null`, non
 * `undefined`). Usato solo per gli item `numeric`, per cui la quantità è
 * per definizione rilevante.
 */
function hasQuantity(item: ChecklistItemLike): boolean {
  return item.quantity !== null && item.quantity !== undefined;
}

/**
 * Verifica se lo stato di un item è "Completata".
 */
function hasCompletedStatus(item: ChecklistItemLike): boolean {
  return item.status === COMPLETED_STATUS;
}

/**
 * Item `boolean`: completo se assegnatario valorizzato e `completed === true`.
 */
function isBooleanItemComplete(item: ChecklistItemLike): boolean {
  return hasAssignee(item) && item.completed === true;
}

/**
 * Item `generic` (o item legacy privi di `type`): completo se assegnatario
 * valorizzato e stato "Completata".
 */
function isGenericItemComplete(item: ChecklistItemLike): boolean {
  return hasAssignee(item) && hasCompletedStatus(item);
}

/**
 * Item `numeric`: come `generic`, più la quantità valorizzata.
 */
function isNumericItemComplete(item: ChecklistItemLike): boolean {
  return isGenericItemComplete(item) && hasQuantity(item);
}

/**
 * Restituisce true se il singolo item soddisfa i criteri di completezza
 * previsti per il suo `type`.
 */
export function isChecklistItemComplete(item: ChecklistItemLike): boolean {
  if (item.type === "boolean") {
    return isBooleanItemComplete(item);
  }

  if (item.type === "numeric") {
    return isNumericItemComplete(item);
  }

  return isGenericItemComplete(item);
}

/**
 * Restituisce true se TUTTI gli item forniti sono completi (checklist
 * senza item incluso: vacuamente completa).
 */
export function isChecklistComplete(items: ChecklistItemLike[]): boolean {
  return items.every(isChecklistItemComplete);
}
