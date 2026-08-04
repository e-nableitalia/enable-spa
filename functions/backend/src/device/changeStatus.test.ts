import type { CallableRequest } from "firebase-functions/v2/https";

const VALID_CONSENTS = {
  privacy: { accepted: true, version: "2026-03" },
  codeOfConduct: { accepted: true, version: "2026-03" },
};

/**
 * Store in-memory minimale che simula le collection Firestore coinvolte:
 * `users` (RBAC + consensi volontario), `deviceRequests` (documento
 * principale + sottocollezione `events`) e `publicDeviceRequests`
 * (sincronizzazione di `publicStatus`, convenzione `dc-public-status`).
 */
let usersStore: Record<string, Record<string, unknown> | undefined>;
let deviceRequestsStore: Record<string, Record<string, unknown> | undefined>;
let eventsStore: Record<string, Array<Record<string, unknown>>>;
let publicStore: Record<string, Record<string, unknown> | undefined>;

// Consente ai test di far fallire la write su publicDeviceRequests per
// verificare che la transazione non produca scritture parziali.
let forcePublicWriteFailure = false;

type WriteRef =
  | { __kind: "deviceRequest"; __id: string }
  | { __kind: "event"; __id: string }
  | { __kind: "public"; __id: string };

interface QueuedWrite {
  ref: WriteRef;
  data: Record<string, unknown>;
  options?: { merge?: boolean };
}

function buildDeviceRequestRef(id: string) {
  return {
    __kind: "deviceRequest" as const,
    __id: id,
    get: jest.fn(() =>
      Promise.resolve({
        exists: deviceRequestsStore[id] !== undefined,
        data: () => deviceRequestsStore[id],
      })
    ),
    collection: jest.fn((sub: string) => {
      if (sub !== "events") {
        throw new Error(`Unexpected subcollection ${sub}`);
      }
      return {
        doc: jest.fn(() => ({ __kind: "event" as const, __id: id })),
      };
    }),
  };
}

function buildCollection(name: string) {
  if (name === "users") {
    return {
      doc: jest.fn((uid: string) => ({
        get: jest.fn(() =>
          Promise.resolve({
            exists: usersStore[uid] !== undefined,
            data: () => usersStore[uid],
          })
        ),
      })),
    };
  }

  if (name === "deviceRequests") {
    return { doc: jest.fn((id: string) => buildDeviceRequestRef(id)) };
  }

  if (name === "publicDeviceRequests") {
    return { doc: jest.fn((id: string) => ({ __kind: "public" as const, __id: id })) };
  }

  throw new Error(`Unexpected collection ${name}`);
}

const collectionMock = jest.fn((name: string) => buildCollection(name));

// Simula l'atomicita' di Firestore: le write vengono accodate durante
// l'esecuzione della callback e "committate" sugli store solo se la
// callback arriva in fondo senza eccezioni. Se una write fallisce, nessuno
// degli store viene toccato.
const runTransactionMock = jest.fn(
  async (updateFn: (tx: { update: jest.Mock; set: jest.Mock }) => Promise<void> | void) => {
    const writes: QueuedWrite[] = [];
    const tx = {
      update: jest.fn((ref: WriteRef, data: Record<string, unknown>) => {
        writes.push({ ref, data });
      }),
      set: jest.fn((ref: WriteRef, data: Record<string, unknown>, options?: { merge?: boolean }) => {
        if (forcePublicWriteFailure && ref.__kind === "public") {
          throw new Error("Simulated Firestore write failure");
        }
        writes.push({ ref, data, options });
      }),
    };

    await updateFn(tx);

    for (const w of writes) {
      if (w.ref.__kind === "deviceRequest") {
        deviceRequestsStore[w.ref.__id] = { ...(deviceRequestsStore[w.ref.__id] ?? {}), ...w.data };
      } else if (w.ref.__kind === "event") {
        eventsStore[w.ref.__id] = eventsStore[w.ref.__id] ?? [];
        eventsStore[w.ref.__id].push(w.data);
      } else if (w.ref.__kind === "public") {
        publicStore[w.ref.__id] = w.options?.merge
          ? { ...(publicStore[w.ref.__id] ?? {}), ...w.data }
          : w.data;
      }
    }
  }
);

jest.mock("firebase-admin/firestore", () => ({
  getFirestore: jest.fn(() => ({
    collection: (name: string) => collectionMock(name),
    runTransaction: (updateFn: (tx: unknown) => Promise<void>) => runTransactionMock(updateFn),
  })),
  FieldValue: {
    serverTimestamp: jest.fn(() => "SERVER_TIMESTAMP"),
  },
}));

// "../utils/telegram" importa il modulo ESM-only "jose": va mockato per
// evitare che ts-jest tenti di trasformare il suo albero di dipendenze
// (non e' invocato in questi scenari, notifica non e' passata in input).
jest.mock("../utils/telegram", () => ({
  sendTelegramMessage: jest.fn(),
}));

import { changeStatus } from "./changeStatus";

function buildRequest(data: Record<string, unknown>, uid: string | null = "admin-1"): CallableRequest {
  return {
    auth: uid ? ({ uid } as CallableRequest["auth"]) : undefined,
    data,
    rawRequest: { headers: {} } as CallableRequest["rawRequest"],
  } as CallableRequest;
}

describe("changeStatus", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    forcePublicWriteFailure = false;

    usersStore = {
      "admin-1": { role: "admin", consents: VALID_CONSENTS },
    };

    deviceRequestsStore = {
      "req-1": { status: "personalizzazione", assignedVolunteers: [] },
    };

    eventsStore = {};
    publicStore = { "req-1": { publicStatus: "fabbricazione in corso" } };
  });

  // Scenario "la transazione aggiorna atomicamente i tre documenti" (EA-106,
  // fonte changeStatus.ts righe 74-98).
  it("updates status/publicStatus/updatedAt, writes the event and syncs publicDeviceRequests in a single transaction", async () => {
    await changeStatus.run(
      buildRequest({ requestId: "req-1", newStatus: "attesa materiali", note: "avanti" }, "admin-1")
    );

    expect(runTransactionMock).toHaveBeenCalledTimes(1);

    expect(deviceRequestsStore["req-1"]).toMatchObject({
      status: "attesa materiali",
      publicStatus: "fabbricazione in corso",
      updatedAt: "SERVER_TIMESTAMP",
    });

    expect(eventsStore["req-1"]).toHaveLength(1);
    expect(eventsStore["req-1"][0]).toEqual({
      type: "status_change",
      fromStatus: "personalizzazione",
      toStatus: "attesa materiali",
      timestamp: "SERVER_TIMESTAMP",
      createdBy: "admin-1",
      note: "avanti",
    });

    expect(publicStore["req-1"]).toEqual({ publicStatus: "fabbricazione in corso" });
  });

  // Scenario "fallimento della transazione non produce scritture parziali"
  // (non regressione, EA-106): se una delle tre write fallisce, nessuno dei
  // tre documenti viene modificato.
  it("leaves all three documents untouched when one of the transaction writes fails", async () => {
    forcePublicWriteFailure = true;

    await expect(
      changeStatus.run(buildRequest({ requestId: "req-1", newStatus: "attesa materiali" }, "admin-1"))
    ).rejects.toThrow("Simulated Firestore write failure");

    expect(deviceRequestsStore["req-1"]).toEqual({
      status: "personalizzazione",
      assignedVolunteers: [],
    });
    expect(eventsStore["req-1"]).toBeUndefined();
    expect(publicStore["req-1"]).toEqual({ publicStatus: "fabbricazione in corso" });
  });
});
