import type { CallableRequest } from "firebase-functions/v2/https";

const GENERATED_CHECKLIST_ID = "generated-checklist-id";
const SERVER_TIMESTAMP_SENTINEL = { __type: "serverTimestamp" };

/**
 * Store in-memory minimale, stesso pattern di
 * `createDeviceRequestChecklist.test.ts`: qui `autoCreateProductionChecklist`
 * è testato end-to-end attraverso la reale `createDeviceRequestChecklist`
 * (non mockata), per verificare il comportamento osservabile dei due
 * scenari Gherkin EA-151 (creazione alla prima transizione, nessuna
 * duplicazione alle successive).
 */
let usersStore: Record<string, Record<string, unknown> | undefined>;
let deviceRequestsStore: Record<string, Record<string, unknown> | undefined>;

const batchSetMock = jest.fn();
const batchCommitMock = jest.fn().mockResolvedValue(undefined);

let generatedItemCounter = 0;
const checklistItemDocMock = jest.fn(() => {
  generatedItemCounter += 1;
  return { id: `generated-item-id-${generatedItemCounter}` };
});

const FIELD_DELETE_SENTINEL = { __type: "fieldDelete" };

function applyUpdate(id: string, updates: Record<string, unknown>) {
  const current = deviceRequestsStore[id] ?? {};
  const { checklistIds: arrayUnionOp, ...rest } = updates as {
    checklistIds?: { __op: "arrayUnion"; values: unknown[] };
    [key: string]: unknown;
  };
  const mergedChecklistIds = arrayUnionOp
    ? Array.from(
      new Set([...(Array.isArray(current.checklistIds) ? current.checklistIds : []), ...arrayUnionOp.values])
    )
    : (current.checklistIds as unknown[] | undefined);
  const merged: Record<string, unknown> = {
    ...current,
    ...rest,
    ...(arrayUnionOp ? { checklistIds: mergedChecklistIds } : {}),
  };
  for (const [key, value] of Object.entries(merged)) {
    if (value === FIELD_DELETE_SENTINEL) delete merged[key];
  }
  deviceRequestsStore[id] = merged;
}

const deviceRequestUpdateMock = jest.fn((id: string, updates: Record<string, unknown>) => {
  applyUpdate(id, updates);
  return Promise.resolve();
});

// Simula l'atomicita' della transazione Firestore usata per il claim del
// guard di idempotenza (vedi autoCreateProductionChecklist.ts): tx.get
// legge lo stato corrente, tx.update accoda una write applicata solo se la
// callback termina senza eccezioni — stesso pattern gia' usato in
// changeStatus.test.ts per applyStatusChangeTransaction.
const runTransactionMock = jest.fn(
  async (updateFn: (tx: { get: jest.Mock; update: jest.Mock }) => Promise<unknown>) => {
    const pendingUpdates: { id: string; data: Record<string, unknown> }[] = [];
    const tx = {
      get: jest.fn((ref: { id: string }) =>
        Promise.resolve({
          exists: deviceRequestsStore[ref.id] !== undefined,
          data: () => deviceRequestsStore[ref.id],
        })
      ),
      update: jest.fn((ref: { id: string }, data: Record<string, unknown>) => {
        pendingUpdates.push({ id: ref.id, data });
      }),
    };
    const result = await updateFn(tx);
    for (const { id, data } of pendingUpdates) {
      applyUpdate(id, data);
    }
    return result;
  }
);

function buildCollection(name: string) {
  if (name === "users") {
    return {
      doc: jest.fn((uid: string) => ({
        get: jest.fn(() =>
          Promise.resolve({ exists: usersStore[uid] !== undefined, data: () => usersStore[uid] })
        ),
      })),
    };
  }

  if (name === "deviceRequests") {
    return {
      doc: jest.fn((id: string) => ({
        id,
        get: jest.fn(() =>
          Promise.resolve({
            exists: deviceRequestsStore[id] !== undefined,
            data: () => deviceRequestsStore[id],
          })
        ),
        update: jest.fn((updates: Record<string, unknown>) => deviceRequestUpdateMock(id, updates)),
      })),
    };
  }

  if (name === "publicDeviceRequests") {
    return { doc: jest.fn(() => ({ get: jest.fn(() => Promise.resolve({ exists: false, data: () => undefined })) })) };
  }

  if (name === "templates") {
    return {
      where: jest.fn(() => ({
        limit: jest.fn(() => ({
          get: jest.fn(() => Promise.resolve({ empty: true, docs: [] })),
        })),
      })),
    };
  }

  if (name === "checklists") {
    return { doc: jest.fn(() => ({ id: GENERATED_CHECKLIST_ID })) };
  }

  if (name === "checklistItems") {
    return { doc: checklistItemDocMock };
  }

  throw new Error(`Unexpected collection ${name}`);
}

const collectionMock = jest.fn((name: string) => buildCollection(name));

jest.mock("firebase-admin/firestore", () => ({
  getFirestore: jest.fn(() => ({
    collection: (name: string) => collectionMock(name),
    batch: jest.fn(() => ({ set: batchSetMock, commit: batchCommitMock })),
    runTransaction: (fn: (tx: { get: jest.Mock; update: jest.Mock }) => Promise<unknown>) => runTransactionMock(fn),
  })),
  FieldValue: {
    serverTimestamp: jest.fn(() => SERVER_TIMESTAMP_SENTINEL),
    arrayUnion: jest.fn((...values: unknown[]) => ({ __op: "arrayUnion", values })),
    delete: jest.fn(() => FIELD_DELETE_SENTINEL),
  },
}));

jest.mock("../security/securityLog", () => ({
  logSecurityEvent: jest.fn().mockResolvedValue(undefined),
}));

import { autoCreateProductionChecklistOnTransition } from "./autoCreateProductionChecklist";

function buildRequest(uid = "admin-1"): CallableRequest {
  return {
    auth: { uid } as CallableRequest["auth"],
    data: {},
    rawRequest: { headers: {} } as CallableRequest["rawRequest"],
  } as CallableRequest;
}

function savedItemDocuments() {
  return batchSetMock.mock.calls
    .filter(([ref]: [{ id: string }]) => ref.id !== GENERATED_CHECKLIST_ID)
    .map(([, document]: [unknown, Record<string, unknown>]) => document);
}

describe("autoCreateProductionChecklistOnTransition", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    generatedItemCounter = 0;

    usersStore = { "admin-1": { role: "admin" } };
    deviceRequestsStore = {
      "req-1": { requestNumber: "REQ-000001", assignedVolunteers: [] },
    };
  });

  // Scenario 1 EA-151: prima transizione a "in produzione" crea la checklist
  it("creates a 5-item checklist with 'Assegnare' items and links its id to checklistIds on first transition to 'in produzione'", async () => {
    await autoCreateProductionChecklistOnTransition(buildRequest(), {
      requestId: "req-1",
      newStatus: "in produzione",
    });

    const items = savedItemDocuments();
    expect(items).toHaveLength(5);
    expect(items.map((item) => item.title)).toEqual([
      "Scelta device e dimensionamento",
      "Personalizzazione",
      "Attesa materiali",
      "Fabbricazione",
      "Fitting",
    ]);
    for (const item of items) {
      expect(item).toMatchObject({ status: "Assegnare", completed: false });
    }

    expect(deviceRequestsStore["req-1"]?.checklistIds).toEqual([GENERATED_CHECKLIST_ID]);
    expect(deviceRequestsStore["req-1"]?.productionChecklistCreated).toBe(true);
  });

  // Scenario 2 EA-151: transizioni successive non duplicano la checklist
  it("does not create a second checklist when productionChecklistCreated is already true (e.g. re-entering after standby)", async () => {
    deviceRequestsStore["req-1"] = {
      ...deviceRequestsStore["req-1"],
      checklistIds: ["existing-production-checklist-id"],
      productionChecklistCreated: true,
    };

    await autoCreateProductionChecklistOnTransition(buildRequest(), {
      requestId: "req-1",
      newStatus: "in produzione",
    });

    expect(batchSetMock).not.toHaveBeenCalled();
    expect(deviceRequestsStore["req-1"]?.checklistIds).toEqual(["existing-production-checklist-id"]);
  });

  // Regressione (adversarial concern, panel review EA-151): il guard va
  // letto DENTRO la transazione, non prima. Simula il caso reale di due
  // `changeStatus` quasi simultanei: la prima transazione parte e resta
  // sospesa a meta' della propria `tx.get` (rappresenta l'invocazione che
  // ha iniziato per prima ma non ha ancora letto lo stato fresco); nel
  // frattempo una seconda transazione, concorrente, va a termine per
  // intero e vince la corsa. Solo quando la prima transazione riprende
  // deve vedere il flag gia' `true` (scritto dalla seconda) e rinunciare:
  // con un guard letto PRIMA della transazione (il bug originale) la prima
  // invocazione avrebbe invece ancora visto lo stato stale e creato una
  // seconda checklist.
  it("claims the guard atomically: a transaction resumed after a concurrent winner sees the fresh flag and skips creation", async () => {
    const gate: { release: () => void } = { release: () => {} };
    const firstGetGate = new Promise<void>((resolve) => {
      gate.release = resolve;
    });

    runTransactionMock.mockImplementationOnce(
      async (updateFn: (tx: { get: jest.Mock; update: jest.Mock }) => Promise<unknown>) => {
        const pendingUpdates: { id: string; data: Record<string, unknown> }[] = [];
        const tx = {
          get: jest.fn(async (ref: { id: string }) => {
            await firstGetGate; // si sblocca solo dopo che la transazione concorrente e' committata
            return {
              exists: deviceRequestsStore[ref.id] !== undefined,
              data: () => deviceRequestsStore[ref.id],
            };
          }),
          update: jest.fn((ref: { id: string }, data: Record<string, unknown>) => {
            pendingUpdates.push({ id: ref.id, data });
          }),
        };
        const result = await updateFn(tx);
        for (const { id, data } of pendingUpdates) {
          applyUpdate(id, data);
        }
        return result;
      }
    );

    const first = autoCreateProductionChecklistOnTransition(buildRequest(), {
      requestId: "req-1",
      newStatus: "in produzione",
    });

    // La transazione concorrente usa il mock di default (non gated) e va a
    // termine per intero prima che la prima si sblocchi: vince la corsa,
    // scrive il flag e crea la sua checklist.
    await autoCreateProductionChecklistOnTransition(buildRequest(), {
      requestId: "req-1",
      newStatus: "in produzione",
    });

    gate.release();
    await first;

    const items = savedItemDocuments();
    expect(items).toHaveLength(5); // una sola checklist creata, non due
    expect(deviceRequestsStore["req-1"]?.checklistIds).toHaveLength(1);
    expect(deviceRequestsStore["req-1"]?.productionChecklistCreated).toBe(true);
  });

  it("does nothing when the target status is not 'in produzione'", async () => {
    await autoCreateProductionChecklistOnTransition(buildRequest(), {
      requestId: "req-1",
      newStatus: "pronta per spedizione",
    });

    expect(batchSetMock).not.toHaveBeenCalled();
    expect(deviceRequestsStore["req-1"]?.checklistIds).toBeUndefined();
  });

  // Nessun gate (EA-151): un fallimento nell'auto-creazione (qui il limite
  // MAX_CHECKLISTS_PER_REQUEST) viene solo loggato, non propagato.
  it("swallows errors from the underlying checklist creation instead of throwing", async () => {
    deviceRequestsStore["req-1"] = {
      ...deviceRequestsStore["req-1"],
      checklistIds: ["c-1", "c-2", "c-3", "c-4", "c-5"],
    };

    await expect(
      autoCreateProductionChecklistOnTransition(buildRequest(), {
        requestId: "req-1",
        newStatus: "in produzione",
      })
    ).resolves.toBeUndefined();

    // Il claim viene scritto prima della creazione, poi rimosso (rollback)
    // perche' la creazione fallisce PRIMA di qualunque scrittura (limite
    // raggiunto: HttpsError("failed-precondition", ...) lanciato dalle
    // validazioni iniziali di createDeviceRequestChecklist.ts, prima del
    // primo createChecklist.run) — un errore provabilmente pre-scrittura,
    // un tentativo futuro deve poter riprovare.
    expect(deviceRequestsStore["req-1"]?.productionChecklistCreated).toBeUndefined();
  });

  // Regressione (adversarial concern, panel review EA-151, secondo giro): il
  // rollback incondizionato di una prima versione di questo fix avrebbe
  // riabilitato un retry anche quando la checklist era gia' stata scritta
  // (batch.commit riuscito) ma il link a checklistIds falliva separatamente
  // — producendo una checklist orfana PIU' una seconda al retry successivo.
  // Un errore che non e' provabilmente pre-scrittura (qui: un fallimento
  // generico durante createChecklist, non uno dei codici HttpsError delle
  // validazioni iniziali) non deve rimuovere il claim.
  it("does NOT roll back the guard when the underlying error is not provably pre-write", async () => {
    batchCommitMock.mockRejectedValueOnce(new Error("simulated deadline-exceeded"));

    await expect(
      autoCreateProductionChecklistOnTransition(buildRequest(), {
        requestId: "req-1",
        newStatus: "in produzione",
      })
    ).resolves.toBeUndefined();

    expect(deviceRequestsStore["req-1"]?.productionChecklistCreated).toBe(true);
  });
});
