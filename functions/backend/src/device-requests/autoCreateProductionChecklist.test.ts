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

const deviceRequestUpdateMock = jest.fn((id: string, updates: Record<string, unknown>) => {
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
  deviceRequestsStore[id] = {
    ...current,
    ...rest,
    ...(arrayUnionOp ? { checklistIds: mergedChecklistIds } : {}),
  };
  return Promise.resolve();
});

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
  })),
  FieldValue: {
    serverTimestamp: jest.fn(() => SERVER_TIMESTAMP_SENTINEL),
    arrayUnion: jest.fn((...values: unknown[]) => ({ __op: "arrayUnion", values })),
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
      productionChecklistAlreadyCreated: false,
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
  it("does not create a second checklist when productionChecklistAlreadyCreated is true (e.g. re-entering after standby)", async () => {
    deviceRequestsStore["req-1"] = {
      ...deviceRequestsStore["req-1"],
      checklistIds: ["existing-production-checklist-id"],
      productionChecklistCreated: true,
    };

    await autoCreateProductionChecklistOnTransition(buildRequest(), {
      requestId: "req-1",
      newStatus: "in produzione",
      productionChecklistAlreadyCreated: true,
    });

    expect(batchSetMock).not.toHaveBeenCalled();
    expect(deviceRequestsStore["req-1"]?.checklistIds).toEqual(["existing-production-checklist-id"]);
  });

  it("does nothing when the target status is not 'in produzione'", async () => {
    await autoCreateProductionChecklistOnTransition(buildRequest(), {
      requestId: "req-1",
      newStatus: "pronta per spedizione",
      productionChecklistAlreadyCreated: false,
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
        productionChecklistAlreadyCreated: false,
      })
    ).resolves.toBeUndefined();

    expect(deviceRequestsStore["req-1"]?.productionChecklistCreated).toBeUndefined();
  });
});
