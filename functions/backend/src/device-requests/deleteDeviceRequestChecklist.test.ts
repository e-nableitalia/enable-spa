import { HttpsError } from "firebase-functions/v2/https";
import type { CallableRequest } from "firebase-functions/v2/https";

const CHECKLIST_ID = "checklist-1";

/**
 * Store in-memory minimale che simula le collection Firestore coinvolte:
 * `users` (RBAC admin-only), `deviceRequests` (documento principale +
 * back-reference array `checklistIds`), `checklists` e `checklistItems`
 * (cancellazione vera, delegata al core Organizer `deleteChecklist.ts` via
 * `.run()`, non mockata: verifica che gli item vengano davvero rimossi,
 * non solo la checklist).
 */
let usersStore: Record<string, Record<string, unknown> | undefined>;
let deviceRequestsStore: Record<string, Record<string, unknown> | undefined>;
let checklistsStore: Record<string, Record<string, unknown> | undefined>;
let checklistItemsStore: Record<string, Record<string, unknown> | undefined>;

type DocRef = { id: string; collection: "checklists" | "checklistItems" };

const deviceRequestUpdateMock = jest.fn((id: string, updates: Record<string, unknown>) => {
  const current = deviceRequestsStore[id] ?? {};
  const { checklistIds: arrayRemoveOp, ...rest } = updates as {
    checklistIds?: { __op: "arrayRemove"; values: unknown[] };
    [key: string]: unknown;
  };
  const currentIds = Array.isArray(current.checklistIds) ? (current.checklistIds as unknown[]) : [];
  const mergedChecklistIds = arrayRemoveOp
    ? currentIds.filter((v) => !arrayRemoveOp.values.includes(v))
    : currentIds;
  deviceRequestsStore[id] = {
    ...current,
    ...rest,
    ...(arrayRemoveOp ? { checklistIds: mergedChecklistIds } : {}),
  };
  return Promise.resolve();
});

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

  if (name === "checklists") {
    return {
      doc: jest.fn((id: string) => ({
        id,
        collection: "checklists" as const,
        get: jest.fn(() =>
          Promise.resolve({ exists: checklistsStore[id] !== undefined, data: () => checklistsStore[id] })
        ),
      })),
    };
  }

  if (name === "checklistItems") {
    return { where: checklistItemsWhereMock };
  }

  throw new Error(`Unexpected collection ${name}`);
}

const collectionMock = jest.fn((name: string) => buildCollection(name));

const batchMock = jest.fn(() => {
  const pending: DocRef[] = [];
  return {
    delete: jest.fn((ref: DocRef) => {
      pending.push(ref);
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
    serverTimestamp: jest.fn(() => "SERVER_TIMESTAMP"),
    arrayRemove: jest.fn((...values: unknown[]) => ({ __op: "arrayRemove", values })),
  },
}));

jest.mock("../security/securityLog", () => ({
  logSecurityEvent: jest.fn().mockResolvedValue(undefined),
}));

import { deleteDeviceRequestChecklist } from "./deleteDeviceRequestChecklist";

function buildRequest(data: Record<string, unknown>, uid: string | null = "admin-1"): CallableRequest {
  return {
    auth: uid ? ({ uid } as CallableRequest["auth"]) : undefined,
    data,
    rawRequest: { headers: {} } as CallableRequest["rawRequest"],
  } as CallableRequest;
}

function seedChecklistItems(checklistId: string, count: number) {
  for (let i = 0; i < count; i++) {
    checklistItemsStore[`item-${checklistId}-${i}`] = { checklistId, title: `Item ${i}` };
  }
}

describe("deleteDeviceRequestChecklist", () => {
  beforeEach(() => {
    jest.clearAllMocks();

    usersStore = {
      "admin-1": { role: "admin" },
      "volunteer-1": { role: "volunteer" },
    };

    deviceRequestsStore = {
      "req-1": {
        requestNumber: "REQ-000001",
        deviceType: "Kinetic Hand",
        assignedVolunteers: ["volunteer-1"],
        checklistIds: [CHECKLIST_ID, "other-checklist-id"],
      },
      "req-no-checklist": {
        requestNumber: "REQ-000002",
        checklistIds: [],
      },
    };

    checklistsStore = {
      [CHECKLIST_ID]: { category: "Kinetic Hand", title: "Checklist di fabbricazione", createdBy: "admin-1" },
    };
    checklistItemsStore = {};
  });

  // Regressione (bug segnalato dall'operatore): eliminare una checklist di
  // un device deve eliminare anche i suoi item, non lasciarli orfani.
  it("deletes the checklist, all its checklistItems, and unlinks it from the device request's checklistIds", async () => {
    seedChecklistItems(CHECKLIST_ID, 3);

    const result = await deleteDeviceRequestChecklist.run(
      buildRequest({ requestId: "req-1", checklistId: CHECKLIST_ID }, "admin-1")
    );

    expect(result).toEqual({ success: true });
    expect(checklistsStore[CHECKLIST_ID]).toBeUndefined();
    expect(
      Object.entries(checklistItemsStore).filter(([, data]) => data?.checklistId === CHECKLIST_ID)
    ).toHaveLength(0);
    expect(deviceRequestsStore["req-1"]?.checklistIds).toEqual(["other-checklist-id"]);
  });

  it("denies deletion to a non-admin (assigned volunteer included)", async () => {
    await expect(
      deleteDeviceRequestChecklist.run(
        buildRequest({ requestId: "req-1", checklistId: CHECKLIST_ID }, "volunteer-1")
      )
    ).rejects.toMatchObject(
      new HttpsError("permission-denied", "Only admin can delete a checklist for a device request")
    );

    expect(checklistsStore[CHECKLIST_ID]).toBeDefined();
    expect(deviceRequestsStore["req-1"]?.checklistIds).toEqual([CHECKLIST_ID, "other-checklist-id"]);
  });

  it("throws unauthenticated when there is no auth context", async () => {
    await expect(
      deleteDeviceRequestChecklist.run(
        buildRequest({ requestId: "req-1", checklistId: CHECKLIST_ID }, null)
      )
    ).rejects.toMatchObject(new HttpsError("unauthenticated", "Authentication required"));

    expect(collectionMock).not.toHaveBeenCalled();
  });

  it("throws not-found when the device request does not exist", async () => {
    await expect(
      deleteDeviceRequestChecklist.run(
        buildRequest({ requestId: "missing-request", checklistId: CHECKLIST_ID }, "admin-1")
      )
    ).rejects.toMatchObject(new HttpsError("not-found", "Device request not found"));
  });

  it("throws failed-precondition when the checklist is not linked to the device request", async () => {
    await expect(
      deleteDeviceRequestChecklist.run(
        buildRequest({ requestId: "req-no-checklist", checklistId: CHECKLIST_ID }, "admin-1")
      )
    ).rejects.toMatchObject(
      new HttpsError("failed-precondition", "The checklist is not linked to this device request")
    );

    expect(checklistsStore[CHECKLIST_ID]).toBeDefined();
  });

  it("throws invalid-argument when requestId is missing", async () => {
    await expect(
      deleteDeviceRequestChecklist.run(buildRequest({ checklistId: CHECKLIST_ID }, "admin-1"))
    ).rejects.toMatchObject(new HttpsError("invalid-argument", "Missing or invalid requestId"));
  });

  it("throws invalid-argument when checklistId is missing", async () => {
    await expect(
      deleteDeviceRequestChecklist.run(buildRequest({ requestId: "req-1" }, "admin-1"))
    ).rejects.toMatchObject(new HttpsError("invalid-argument", "Missing or invalid checklistId"));
  });
});
