import { FieldValue } from "firebase-admin/firestore";
import type { DocumentReference, Transaction } from "firebase-admin/firestore";

export interface ApplyStatusChangeParams {
  currentStatus: string;
  newStatus: string;
  createdBy: string;
  note?: string | null;
}

/**
 * Costruisce, dentro la transazione `tx` già aperta dal caller, i due write
 * collegati a un cambio di stato: aggiornamento del documento principale ed
 * evento di event sourcing (`dc-request-event`). Non esegue alcuna I/O
 * propria: l'atomicità resta responsabilità della `db.runTransaction` del
 * caller.
 */
export function applyStatusChangeTransaction(
  tx: Transaction,
  requestRef: DocumentReference,
  params: ApplyStatusChangeParams
): void {
  const { currentStatus, newStatus, createdBy, note } = params;

  tx.update(requestRef, {
    status: newStatus,
    updatedAt: FieldValue.serverTimestamp(),
  });

  tx.set(requestRef.collection("events").doc(), {
    type: "status_change",
    fromStatus: currentStatus,
    toStatus: newStatus,
    timestamp: FieldValue.serverTimestamp(),
    createdBy,
    note: note ?? null,
  });
}
