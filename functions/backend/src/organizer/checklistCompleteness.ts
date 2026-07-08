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
 * Definizione di completezza di un item (riferimento: `canConfirm` nel
 * mockup allegato all'Epic):
 * - l'assegnatario è valorizzato (non null, non stringa vuota/whitespace);
 * - la quantità è valorizzata SE l'item ha il campo quantità: la presenza
 *   della chiave `quantity` (anche con valore `null`) indica che la
 *   quantità è rilevante per quell'item e quindi deve essere valorizzata;
 *   se la chiave è del tutto assente (`undefined`), l'item non richiede
 *   quantità e il controllo viene ignorato per quell'item;
 * - lo stato è diverso da "Assegnare" (stato iniziale del modello v1).
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
  assignee?: string | null;
  quantity?: number | null;
  status: string;
}

const INITIAL_STATUS = "Assegnare";

/**
 * Verifica se l'assegnatario di un item è valorizzato.
 */
function hasAssignee(item: ChecklistItemLike): boolean {
  return typeof item.assignee === "string" && item.assignee.trim().length > 0;
}

/**
 * Verifica se il campo quantità, quando rilevante (presente sull'item),
 * è valorizzato. Se il campo non è presente sull'item, la quantità non è
 * rilevante per quell'item e il controllo è considerato soddisfatto.
 */
function hasQuantityWhenRelevant(item: ChecklistItemLike): boolean {
  const isQuantityRelevant = Object.prototype.hasOwnProperty.call(item, "quantity") &&
    item.quantity !== undefined;

  if (!isQuantityRelevant) {
    return true;
  }

  return item.quantity !== null;
}

/**
 * Verifica se lo stato di un item è diverso dallo stato iniziale
 * "Assegnare".
 */
function hasProgressedPastInitialStatus(item: ChecklistItemLike): boolean {
  return item.status !== INITIAL_STATUS;
}

/**
 * Restituisce true se il singolo item soddisfa tutti i criteri di
 * completezza.
 */
export function isChecklistItemComplete(item: ChecklistItemLike): boolean {
  return hasAssignee(item) &&
    hasQuantityWhenRelevant(item) &&
    hasProgressedPastInitialStatus(item);
}

/**
 * Restituisce true se TUTTI gli item forniti sono completi (checklist
 * senza item incluso: vacuamente completa).
 */
export function isChecklistComplete(items: ChecklistItemLike[]): boolean {
  return items.every(isChecklistItemComplete);
}
