import { HttpsError } from "firebase-functions/v2/https";
import type { CallableRequest } from "firebase-functions/v2/https";

const CHECKLIST_ID = "checklist-1";
const SERVER_TIMESTAMP_SENTINEL = { __type: "serverTimestamp" };

let usersStore: Record<string, Record<string, unknown> | undefined>;
let deviceRequestsStore: Record<string, Record<string, unknown> | undefined>;
let checklistsStore: Record<string, Record<string, unknown> | undefined>;

const checklistUpdateMock = jest.fn((id: string, updates: Record<string, unknown>) => {
  checklistsStore[id] = { ...checklistsStore[id], items: updates.items };
  return Promise.resolve();
});

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

  throw new Error(`Unexpected collection ${name}`);
}

const collectionMock = jest.fn((name: string) => buildCollection(name));

jest.mock("firebase-admin/firestore", () => ({
  getFirestore: jest.fn(() => ({
    collection: (name: string) => collectionMock(name),
  })),
  FieldValue: {
    serverTimestamp: jest.fn(() => SERVER_TIMESTAMP_SENTINEL),
  },
}));

jest.mock("../security/securityLog", () => ({
  logSecurityEvent: jest.fn().mockResolvedValue(undefined),
}));

import { removeDeviceRequestChecklistItem } from "./removeDeviceRequestChecklistItem";

function buildRequest(data: Record<string, unknown>, uid: string | null = "admin-1"): CallableRequest {
  return {
    auth: uid ? ({ uid, token: { email: "user@example.com" } } as CallableRequest["auth"]) : undefined,
    data,
    rawRequest: { headers: {} } as CallableRequest["rawRequest"],
  } as CallableRequest;
}

describe("removeDeviceRequestChecklistItem", () => {
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
        checklistId: CHECKLIST_ID,
      },
    };

    checklistsStore = {
      [CHECKLIST_ID]: {
        items: [
          { id: "item-1", title: "Prepara stampante", assignee: null, quantity: null, notes: "", status: "Assegnare", completed: false },
          { id: "item-2", title: "Verifica materiale", assignee: null, quantity: null, notes: "", status: "Assegnare", completed: false },
        ],
      },
    };
  });

  it("removes the item from the checklist linked to the request (admin)", async () => {
    const result = await removeDeviceRequestChecklistItem.run(
      buildRequest({ requestId: "req-1", itemId: "item-1" }, "admin-1")
    );

    expect(result).toEqual({ success: true });
    const remainingItems = checklistsStore[CHECKLIST_ID]?.items as Record<string, unknown>[];
    expect(remainingItems.map((i) => i.id)).toEqual(["item-2"]);
  });

  it("allows a volunteer assigned to the request to remove an item", async () => {
    const result = await removeDeviceRequestChecklistItem.run(
      buildRequest({ requestId: "req-1", itemId: "item-2" }, "volunteer-1")
    );

    expect(result).toEqual({ success: true });
  });

  it("denies removing an item to a volunteer not assigned to the request", async () => {
    await expect(
      removeDeviceRequestChecklistItem.run(
        buildRequest({ requestId: "req-1", itemId: "item-1" }, "volunteer-2")
      )
    ).rejects.toMatchObject(
      new HttpsError("permission-denied", "Only admin or assigned volunteers can access the checklist for this request")
    );

    expect(checklistUpdateMock).not.toHaveBeenCalled();
  });

  it("throws unauthenticated when there is no auth context", async () => {
    await expect(
      removeDeviceRequestChecklistItem.run(buildRequest({ requestId: "req-1", itemId: "item-1" }, null))
    ).rejects.toMatchObject(new HttpsError("unauthenticated", "User must be authenticated"));

    expect(collectionMock).not.toHaveBeenCalled();
  });

  it("throws invalid-argument when requestId is missing", async () => {
    await expect(
      removeDeviceRequestChecklistItem.run(buildRequest({ itemId: "item-1" }, "admin-1"))
    ).rejects.toMatchObject(new HttpsError("invalid-argument", "Missing parameter: requestId"));

    expect(checklistUpdateMock).not.toHaveBeenCalled();
  });

  it("propagates not-found from the core removeChecklistItem when itemId does not exist", async () => {
    await expect(
      removeDeviceRequestChecklistItem.run(
        buildRequest({ requestId: "req-1", itemId: "missing-item" }, "admin-1")
      )
    ).rejects.toMatchObject(new HttpsError("not-found", "Checklist item not found"));

    expect(checklistUpdateMock).not.toHaveBeenCalled();
  });
});
