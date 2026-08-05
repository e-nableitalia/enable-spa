import { HttpsError } from "firebase-functions/v2/https";
import type { CallableRequest } from "firebase-functions/v2/https";

const CHECKLIST_ID = "checklist-1";
const SERVER_TIMESTAMP_SENTINEL = { __type: "serverTimestamp" };

let usersStore: Record<string, Record<string, unknown> | undefined>;
let deviceRequestsStore: Record<string, Record<string, unknown> | undefined>;
let checklistsStore: Record<string, Record<string, unknown> | undefined>;
let checklistItemsStore: Record<string, Record<string, unknown> | undefined>;
let checklistItemIdCounter = 0;

const checklistUpdateMock = jest.fn((id: string, updates: Record<string, unknown>) => {
  checklistsStore[id] = { ...checklistsStore[id], ...updates };
  return Promise.resolve();
});
const checklistItemSetMock = jest.fn((id: string, data: Record<string, unknown>) => {
  checklistItemsStore[id] = data;
});
const batchCommitMock = jest.fn().mockResolvedValue(undefined);

function applyArrayFieldValue(current: unknown, value: unknown): unknown {
  if (value && typeof value === "object" && "__type" in (value as Record<string, unknown>)) {
    const sentinel = value as { __type: string; items: unknown[] };
    const existing = Array.isArray(current) ? current : [];
    if (sentinel.__type === "arrayUnion") {
      return [...existing, ...sentinel.items];
    }
    if (sentinel.__type === "arrayRemove") {
      return existing.filter((item) => !sentinel.items.includes(item));
    }
  }
  return value;
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
    return {
      doc: jest.fn((id: string) => ({
        get: jest.fn(() =>
          Promise.resolve({
            exists: deviceRequestsStore[id] !== undefined,
            data: () => deviceRequestsStore[id],
          })
        ),
      })),
    };
  }

  if (name === "checklists") {
    return {
      doc: jest.fn((id: string) => ({
        id,
        _collection: "checklists",
        get: jest.fn(() =>
          Promise.resolve({
            exists: checklistsStore[id] !== undefined,
            data: () => checklistsStore[id],
          })
        ),
        update: jest.fn((updates: Record<string, unknown>) => checklistUpdateMock(id, updates)),
      })),
    };
  }

  if (name === "checklistItems") {
    return {
      doc: jest.fn((id?: string) => {
        const docId = id ?? `generated-item-id-${++checklistItemIdCounter}`;
        return {
          id: docId,
          _collection: "checklistItems",
          get: jest.fn(() =>
            Promise.resolve({
              exists: checklistItemsStore[docId] !== undefined,
              data: () => checklistItemsStore[docId],
            })
          ),
        };
      }),
    };
  }

  throw new Error(`Unexpected collection ${name}`);
}

const collectionMock = jest.fn((name: string) => buildCollection(name));

jest.mock("firebase-admin/firestore", () => ({
  getFirestore: jest.fn(() => ({
    collection: (name: string) => collectionMock(name),
    batch: jest.fn(() => ({
      set: jest.fn((ref: { id: string; _collection: string }, data: Record<string, unknown>) => {
        if (ref._collection === "checklistItems") {
          checklistItemSetMock(ref.id, data);
        }
      }),
      update: jest.fn((ref: { id: string; _collection: string }, updates: Record<string, unknown>) => {
        if (ref._collection === "checklists") {
          const resolved = { ...updates };
          if ("items" in resolved) {
            resolved.items = applyArrayFieldValue(checklistsStore[ref.id]?.items, resolved.items);
          }
          checklistUpdateMock(ref.id, resolved);
        }
      }),
      commit: batchCommitMock,
    })),
  })),
  FieldValue: {
    serverTimestamp: jest.fn(() => SERVER_TIMESTAMP_SENTINEL),
    arrayUnion: jest.fn((...items: unknown[]) => ({ __type: "arrayUnion", items })),
  },
}));

jest.mock("../security/securityLog", () => ({
  logSecurityEvent: jest.fn().mockResolvedValue(undefined),
}));

import { addDeviceRequestChecklistItem } from "./addDeviceRequestChecklistItem";

function buildRequest(data: Record<string, unknown>, uid: string | null = "admin-1"): CallableRequest {
  return {
    auth: uid ? ({ uid, token: { email: "user@example.com" } } as CallableRequest["auth"]) : undefined,
    data,
    rawRequest: { headers: {} } as CallableRequest["rawRequest"],
  } as CallableRequest;
}

describe("addDeviceRequestChecklistItem", () => {
  beforeEach(() => {
    jest.clearAllMocks();

    usersStore = {
      "admin-1": { role: "admin" },
      "volunteer-1": { role: "volunteer" },
      "volunteer-2": { role: "volunteer" },
    };

    deviceRequestsStore = {
      "req-1": {
        assignedVolunteers: ["volunteer-1"],
        checklistIds: [CHECKLIST_ID],
      },
      "req-legacy": {
        assignedVolunteers: ["volunteer-1"],
        checklistId: CHECKLIST_ID,
      },
    };

    checklistsStore = {
      [CHECKLIST_ID]: { category: "devicetype-mano", items: [] },
    };
    checklistItemsStore = {};
    checklistItemIdCounter = 0;
  });

  it("adds an item to the checklist linked to the request (admin)", async () => {
    const result = await addDeviceRequestChecklistItem.run(
      buildRequest(
        { requestId: "req-1", checklistId: CHECKLIST_ID, title: "Prepara stampante", type: "numeric", quantity: 2 },
        "admin-1"
      )
    );

    expect(result).toHaveProperty("itemId");
    expect(typeof result.itemId).toBe("string");

    const newItem = checklistItemsStore[result.itemId];
    expect(newItem).toMatchObject({
      checklistId: CHECKLIST_ID,
      title: "Prepara stampante",
      type: "numeric",
      quantity: 2,
      status: "Assegnare",
      completed: false,
    });
    expect(checklistsStore[CHECKLIST_ID]?.items).toEqual([result.itemId]);
  });

  it("allows a volunteer assigned to the request to add an item", async () => {
    const result = await addDeviceRequestChecklistItem.run(
      buildRequest(
        { requestId: "req-1", checklistId: CHECKLIST_ID, title: "Verifica materiale", type: "generic" },
        "volunteer-1"
      )
    );

    expect(result).toHaveProperty("itemId");
  });

  it("denies adding an item to a volunteer not assigned to the request", async () => {
    await expect(
      addDeviceRequestChecklistItem.run(
        buildRequest({ requestId: "req-1", checklistId: CHECKLIST_ID, title: "Titolo" }, "volunteer-2")
      )
    ).rejects.toMatchObject(
      new HttpsError("permission-denied", "Only admin or assigned volunteers can access the checklist for this request")
    );

    expect(checklistUpdateMock).not.toHaveBeenCalled();
  });

  // Scenario 3 (EA-131): checklistId non appartenente a checklistIds -> not-found.
  it("throws not-found when checklistId does not belong to checklistIds of the request", async () => {
    await expect(
      addDeviceRequestChecklistItem.run(
        buildRequest({ requestId: "req-1", checklistId: "other-checklist", title: "Titolo" }, "admin-1")
      )
    ).rejects.toMatchObject(new HttpsError("not-found", "Checklist not linked to this device request"));

    expect(checklistUpdateMock).not.toHaveBeenCalled();
  });

  // Scenario 5 (EA-133): nessun dual-read sul vecchio campo singolare
  // checklistId -> not-found, anche se il campo legacy e' ancora presente.
  it("throws not-found for a legacy request with only the singular checklistId field, no fallback", async () => {
    await expect(
      addDeviceRequestChecklistItem.run(
        buildRequest(
          { requestId: "req-legacy", checklistId: CHECKLIST_ID, title: "Titolo", type: "generic" },
          "volunteer-1"
        )
      )
    ).rejects.toMatchObject(new HttpsError("not-found", "Checklist not linked to this device request"));
  });

  it("throws unauthenticated when there is no auth context", async () => {
    await expect(
      addDeviceRequestChecklistItem.run(
        buildRequest({ requestId: "req-1", checklistId: CHECKLIST_ID, title: "Titolo" }, null)
      )
    ).rejects.toMatchObject(new HttpsError("unauthenticated", "User must be authenticated"));

    expect(collectionMock).not.toHaveBeenCalled();
  });

  it("throws invalid-argument when requestId is missing", async () => {
    await expect(
      addDeviceRequestChecklistItem.run(buildRequest({ checklistId: CHECKLIST_ID, title: "Titolo" }, "admin-1"))
    ).rejects.toMatchObject(new HttpsError("invalid-argument", "Missing parameter: requestId"));

    expect(checklistUpdateMock).not.toHaveBeenCalled();
  });

  // Scenario 2 (EA-131): vecchio contratto (solo requestId, senza checklistId) -> invalid-argument.
  it("throws invalid-argument when checklistId is missing", async () => {
    await expect(
      addDeviceRequestChecklistItem.run(buildRequest({ requestId: "req-1", title: "Titolo" }, "admin-1"))
    ).rejects.toMatchObject(new HttpsError("invalid-argument", "Missing parameter: checklistId"));

    expect(checklistUpdateMock).not.toHaveBeenCalled();
  });

  it("propagates invalid-argument from the core addChecklistItem when title is missing", async () => {
    await expect(
      addDeviceRequestChecklistItem.run(buildRequest({ requestId: "req-1", checklistId: CHECKLIST_ID }, "admin-1"))
    ).rejects.toMatchObject(new HttpsError("invalid-argument", "Missing title"));

    expect(checklistUpdateMock).not.toHaveBeenCalled();
  });
});
