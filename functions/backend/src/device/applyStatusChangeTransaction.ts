import { FieldValue } from "firebase-admin/firestore";
import type { DocumentReference, Firestore, Transaction } from "firebase-admin/firestore";
import { mapToPublicStatus } from "../utils/mapToPublicStatus";

export interface ApplyStatusChangeParams {
  db: Firestore;
  requestId: string;
  currentStatus: string;
  newStatus: string;
  createdBy: string;
  note?: string | null;
}

/**
 * Costruisce, dentro la transazione `tx` già aperta dal caller, i tre write
 * collegati a un cambio di stato: aggiornamento del documento principale,
 * evento di event sourcing (`dc-request-event`) e sincronizzazione di
 * `publicStatus` verso `publicDeviceRequests` (`dc-public-status`). Non
 * esegue alcuna I/O propria: l'atomicità resta responsabilità della
 * `db.runTransaction` del caller.
 */
export function applyStatusChangeTransaction(
  tx: Transaction,
  requestRef: DocumentReference,
  params: ApplyStatusChangeParams
): void {
  const { db, requestId, currentStatus, newStatus, createdBy, note } = params;

  tx.update(requestRef, {
    status: newStatus,
    publicStatus: mapToPublicStatus(newStatus),
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

  tx.set(
    db.collection("publicDeviceRequests").doc(requestId),
    { publicStatus: mapToPublicStatus(newStatus) },
    { merge: true }
  );
}
