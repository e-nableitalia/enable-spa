jest.mock("firebase-admin/firestore", () => ({
  FieldValue: {
    serverTimestamp: jest.fn(() => "SERVER_TIMESTAMP"),
  },
}));

import type { DocumentReference, Transaction } from "firebase-admin/firestore";
import { applyStatusChangeTransaction } from "./applyStatusChangeTransaction";

function buildTx() {
  return {
    update: jest.fn(),
    set: jest.fn(),
  };
}

function buildRequestRef(eventDocRef: unknown) {
  return {
    id: "req-1",
    collection: jest.fn((name: string) => {
      if (name !== "events") {
        throw new Error(`Unexpected subcollection ${name}`);
      }
      return { doc: jest.fn(() => eventDocRef) };
    }),
  };
}

function buildDb(publicDocRef: unknown) {
  return {
    collection: jest.fn((name: string) => {
      if (name !== "publicDeviceRequests") {
        throw new Error(`Unexpected collection ${name}`);
      }
      return { doc: jest.fn(() => publicDocRef) };
    }),
  };
}

describe("applyStatusChangeTransaction", () => {
  // Scenario "la transazione aggiorna atomicamente i tre documenti" (EA-106):
  // le tre write vengono accodate sulla stessa tx, senza I/O proprio.
  it("queues the three writes (status update, event, public sync) on the given tx", () => {
    const tx = buildTx();
    const eventDocRef = { id: "event-1" };
    const publicDocRef = { id: "req-1" };
    const requestRef = buildRequestRef(eventDocRef);
    const db = buildDb(publicDocRef);

    applyStatusChangeTransaction(tx as unknown as Transaction, requestRef as unknown as DocumentReference, {
      db: db as never,
      requestId: "req-1",
      currentStatus: "personalizzazione",
      newStatus: "attesa materiali",
      createdBy: "volunteer-1",
      note: "nota di transizione",
    });

    expect(tx.update).toHaveBeenCalledTimes(1);
    expect(tx.update).toHaveBeenCalledWith(requestRef, {
      status: "attesa materiali",
      publicStatus: "fabbricazione in corso",
      updatedAt: "SERVER_TIMESTAMP",
    });

    expect(tx.set).toHaveBeenCalledTimes(2);
    expect(tx.set).toHaveBeenNthCalledWith(1, eventDocRef, {
      type: "status_change",
      fromStatus: "personalizzazione",
      toStatus: "attesa materiali",
      timestamp: "SERVER_TIMESTAMP",
      createdBy: "volunteer-1",
      note: "nota di transizione",
    });
    expect(tx.set).toHaveBeenNthCalledWith(
      2,
      publicDocRef,
      { publicStatus: "fabbricazione in corso" },
      { merge: true }
    );
  });

  // Scenario "struttura dell'evento invariata" (EA-106): esattamente i 6
  // campi previsti, note = null quando non fornita.
  it("writes an event with exactly the expected fields, note=null when omitted", () => {
    const tx = buildTx();
    const eventDocRef = { id: "event-2" };
    const requestRef = buildRequestRef(eventDocRef);
    const db = buildDb({ id: "req-2" });

    applyStatusChangeTransaction(tx as unknown as Transaction, requestRef as unknown as DocumentReference, {
      db: db as never,
      requestId: "req-2",
      currentStatus: "inviata",
      newStatus: "famiglia contattata",
      createdBy: "admin-1",
    });

    const [, eventPayload] = tx.set.mock.calls[0];
    expect(Object.keys(eventPayload).sort()).toEqual(
      ["createdBy", "fromStatus", "note", "timestamp", "toStatus", "type"].sort()
    );
    expect(eventPayload).toEqual({
      type: "status_change",
      fromStatus: "inviata",
      toStatus: "famiglia contattata",
      timestamp: "SERVER_TIMESTAMP",
      createdBy: "admin-1",
      note: null,
    });
  });
});
