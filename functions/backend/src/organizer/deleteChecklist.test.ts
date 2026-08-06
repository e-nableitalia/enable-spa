import { HttpsError } from "firebase-functions/v2/https";
import type { CallableRequest } from "firebase-functions/v2/https";

const SERVER_TIMESTAMP_SENTINEL = { __type: "serverTimestamp" };
const CHECKLIST_ID = "existing-checklist-id";
const GENERATED_CHECKLIST_ID = "generated-checklist-id";

type DocRef = { id: string; collection: "checklists" | "checklistItems" };

/**
 * Store in-memory condiviso tra createChecklist e deleteChecklist: serve a
 * verificare che deleteChecklist legga davvero il campo `createdBy` scritto
 * da createChecklist, invece di mascherare il comportamento impostandolo a
 * mano sul mock (F-1).
 */
let checklistsStore: Record<string, Record<string, unknown> | undefined>;
let checklistItemsStore: Record<string, Record<string, unknown> | undefined>;
let userRole: string | undefined;

function buildChecklistDoc(id: string) {
  return {
    id,
    collection: "checklists" as const,
    get: jest.fn(() =>
      Promise.resolve({
        exists: checklistsStore[id] !== undefined,
        data: () => checklistsStore[id],
      })
    ),
    set: jest.fn((data: Record<string, unknown>) => {
      checklistsStore[id] = data;
      return Promise.resolve();
    }),
  };
}

const checklistsDocMock = jest.fn((id?: string) => buildChecklistDoc(id ?? GENERATED_CHECKLIST_ID));
const userDocMock = jest.fn(() => ({
  get: jest.fn(() => Promise.resolve({ exists: true, data: () => ({ role: userRole }) })),
}));

const checklistItemsWhereMock = jest.fn((field: string, _op: string, value: string) => ({
  get: jest.fn(() => {
    const matchingIds = Object.entries(checklistItemsStore)
      .filter(([, data]) => data !== undefined && (data as Record<string, unknown>)[field] === value)
      .map(([id]) => id);
    return Promise.resolve({
      docs: matchingIds.map((id) => ({ ref: { id, collection: "checklistItems" as const } })),
    });
  }),
}));

const collectionMock = jest.fn((name: string) => {
  if (name === "users") return { doc: userDocMock };
  if (name === "checklistItems") return { where: checklistItemsWhereMock };
  return { doc: checklistsDocMock };
});

/**
 * db.batch() mockato con chunking reale: ogni chiamata a batch() crea
 * un'istanza indipendente con il proprio elenco di delete() pendenti,
 * applicati allo store solo al commit() — serve a verificare che
 * deleteChecklist apra piu' batch quando i documenti da eliminare superano
 * il limite Firestore di 500 operazioni per commit.
 *
 * Supporta anche `set()` (EA-137: createChecklist, usato dai test di
 * "creator authorization" per costruire un fixture reale invece di
 * impostare createdBy a mano, scrive la checklist via db.batch().set(...)
 * sulla collection checklists) — applicato immediatamente, non in coda
 * come le delete, dato che nessun test qui verifica atomicita' del set.
 */
const batchMock = jest.fn(() => {
  const pending: DocRef[] = [];
  return {
    delete: jest.fn((ref: DocRef) => {
      pending.push(ref);
    }),
    set: jest.fn((ref: { id: string }, data: Record<string, unknown>) => {
      checklistsStore[ref.id] = data;
    }),
    commit: jest.fn(() => {
      for (const ref of pending) {
        if (ref.collection === "checklists") {
          delete checklistsStore[ref.id];
        } else {
          delete checklistItemsStore[ref.id];
        }
      }
      return Promise.resolve();
    }),
  };
});

jest.mock("firebase-admin/firestore", () => ({
  getFirestore: jest.fn(() => ({
    collection: (name: string) => collectionMock(name),
    batch: () => batchMock(),
  })),
  FieldValue: {
    serverTimestamp: jest.fn(() => SERVER_TIMESTAMP_SENTINEL),
  },
}));

jest.mock("../security/securityLog", () => ({
  logSecurityEvent: jest.fn().mockResolvedValue(undefined),
}));

import { deleteChecklist } from "./deleteChecklist";
import { createChecklist } from "./createChecklist";

function buildRequest(data: Record<string, unknown>, uid: string | null = "user-1"): CallableRequest {
  return {
    auth: uid ? { uid, token: { email: "user@example.com" } } : undefined,
    data,
    rawRequest: { headers: {} } as CallableRequest["rawRequest"],
  } as CallableRequest;
}

async function readChecklistOrThrowNotFound(checklistId: string) {
  const snap = await checklistsDocMock(checklistId).get();
  if (!snap.exists) {
    throw new HttpsError("not-found", "Checklist not found");
  }
  return snap.data();
}

function seedChecklistItems(checklistId: string, count: number) {
  for (let i = 0; i < count; i++) {
    checklistItemsStore[`item-${checklistId}-${i}`] = { checklistId, title: `Item ${i}` };
  }
}

describe("deleteChecklist", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    checklistsStore = {};
    checklistItemsStore = {};
    userRole = "admin";
  });

  it("deletes the checklists/{checklistId} document and all its referenced checklistItems (under 500)", async () => {
    checklistsStore[CHECKLIST_ID] = {
      category: "devicetype-arto-superiore",
      title: "Checklist evento",
      createdBy: "some-other-uid",
      createdAt: { seconds: 0, nanoseconds: 0 },
    };
    seedChecklistItems(CHECKLIST_ID, 3);
    // item di un'altra checklist: non deve essere toccato dalla query/batch delete
    checklistItemsStore["item-other-checklist-0"] = { checklistId: "other-checklist-id", title: "Item altrove" };

    const result = await deleteChecklist.run(buildRequest({ checklistId: CHECKLIST_ID }));

    expect(collectionMock).toHaveBeenCalledWith("checklistItems");
    expect(checklistItemsWhereMock).toHaveBeenCalledWith("checklistId", "==", CHECKLIST_ID);
    expect(batchMock).toHaveBeenCalledTimes(1);
    expect(checklistsStore[CHECKLIST_ID]).toBeUndefined();
    expect(
      Object.entries(checklistItemsStore).filter(([, data]) => data?.checklistId === CHECKLIST_ID)
    ).toHaveLength(0);
    expect(checklistItemsStore["item-other-checklist-0"]).toBeDefined();
    expect(result).toEqual({ success: true });
  });

  it("deletes all checklistItems beyond the 500 operations-per-batch Firestore limit, chunking across multiple batches", async () => {
    checklistsStore[CHECKLIST_ID] = {
      category: "devicetype-arto-superiore",
      title: "Checklist evento",
      createdBy: "some-other-uid",
      createdAt: { seconds: 0, nanoseconds: 0 },
    };
    const ITEM_COUNT = 520;
    seedChecklistItems(CHECKLIST_ID, ITEM_COUNT);

    const result = await deleteChecklist.run(buildRequest({ checklistId: CHECKLIST_ID }));

    // 1 checklist doc + 520 item = 521 delete op totali -> 2 batch (500 + 21)
    expect(batchMock).toHaveBeenCalledTimes(2);
    expect(checklistsStore[CHECKLIST_ID]).toBeUndefined();
    expect(
      Object.entries(checklistItemsStore).filter(([, data]) => data?.checklistId === CHECKLIST_ID)
    ).toHaveLength(0);
    expect(result).toEqual({ success: true });
  });

  it("makes a subsequent getChecklist on the same checklistId return not-found", async () => {
    checklistsStore[CHECKLIST_ID] = {
      category: "devicetype-arto-superiore",
      title: "Checklist evento",
      createdBy: "some-other-uid",
      createdAt: { seconds: 0, nanoseconds: 0 },
    };

    await deleteChecklist.run(buildRequest({ checklistId: CHECKLIST_ID }));

    await expect(readChecklistOrThrowNotFound(CHECKLIST_ID)).rejects.toMatchObject(
      new HttpsError("not-found", "Checklist not found")
    );
  });

  it("throws not-found and does not query/delete checklistItems when the checklist does not exist", async () => {
    await expect(
      deleteChecklist.run(buildRequest({ checklistId: CHECKLIST_ID }))
    ).rejects.toMatchObject(new HttpsError("not-found", "Checklist not found"));

    expect(checklistItemsWhereMock).not.toHaveBeenCalled();
    expect(batchMock).not.toHaveBeenCalled();
  });

  it("throws unauthenticated when there is no auth context", async () => {
    await expect(
      deleteChecklist.run(buildRequest({ checklistId: CHECKLIST_ID }, null))
    ).rejects.toMatchObject(new HttpsError("unauthenticated", "User must be authenticated"));

    expect(batchMock).not.toHaveBeenCalled();
  });

  it("throws invalid-argument when checklistId is missing", async () => {
    await expect(deleteChecklist.run(buildRequest({}))).rejects.toMatchObject(
      new HttpsError("invalid-argument", "Missing checklistId")
    );

    expect(batchMock).not.toHaveBeenCalled();
  });

  describe("RBAC invariato (F-1: createdBy e' scritto dalle funzioni di creazione)", () => {
    it("allows the creator of the checklist, as recorded by createChecklist, to delete it even without an admin role", async () => {
      userRole = "volunteer";

      const { checklistId } = await createChecklist.run(
        buildRequest(
          { category: "devicetype-mano", title: "Checklist evento", items: [] },
          "creator-uid"
        )
      );
      expect(checklistsStore[checklistId]?.createdBy).toBe("creator-uid");

      const result = await deleteChecklist.run(buildRequest({ checklistId }, "creator-uid"));

      expect(result).toEqual({ success: true });
    });

    it("rejects with permission-denied a non-admin user whose createdBy does not match their own uid, unchanged pre-existing behavior", async () => {
      userRole = "volunteer";

      const { checklistId } = await createChecklist.run(
        buildRequest(
          { category: "devicetype-mano", title: "Checklist evento", items: [] },
          "creator-uid"
        )
      );

      // batchMock e' gia' stato chiamato una volta dal fixture createChecklist qui sopra
      // (EA-137: scrive via db.batch()): isolare le sole chiamate della deleteChecklist
      // sotto test, non quelle del setup.
      batchMock.mockClear();

      await expect(
        deleteChecklist.run(buildRequest({ checklistId }, "other-uid"))
      ).rejects.toMatchObject(
        new HttpsError("permission-denied", "Cannot delete another user's checklist")
      );

      expect(checklistItemsWhereMock).not.toHaveBeenCalled();
      expect(batchMock).not.toHaveBeenCalled();
    });
  });
});
