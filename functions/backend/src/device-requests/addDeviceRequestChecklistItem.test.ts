import { HttpsError } from "firebase-functions/v2/https";
import type { CallableRequest } from "firebase-functions/v2/https";

const CHECKLIST_ID = "checklist-1";
const SERVER_TIMESTAMP_SENTINEL = { __type: "serverTimestamp" };

let usersStore: Record<string, Record<string, unknown> | undefined>;
let deviceRequestsStore: Record<string, Record<string, unknown> | undefined>;
let checklistsStore: Record<string, Record<string, unknown> | undefined>;

const checklistUpdateMock = jest.fn((id: string, updates: Record<string, unknown>) => {
  const items = (updates.items as { items: unknown[] })?.items ?? checklistsStore[id]?.items;
  checklistsStore[id] = { ...checklistsStore[id], items };
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
        checklistId: CHECKLIST_ID,
      },
    };

    checklistsStore = {
      [CHECKLIST_ID]: { items: [] },
    };
  });

  it("adds an item to the checklist linked to the request (admin)", async () => {
    const result = await addDeviceRequestChecklistItem.run(
      buildRequest({ requestId: "req-1", title: "Prepara stampante", type: "numeric", quantity: 2 }, "admin-1")
    );

    expect(result).toHaveProperty("itemId");
    expect(typeof result.itemId).toBe("string");

    const [updatePayload] = checklistUpdateMock.mock.calls[0].slice(1) as [
      { items: { items: unknown[] } }
    ];
    const [newItem] = updatePayload.items.items;
    expect(newItem).toMatchObject({ title: "Prepara stampante", type: "numeric", quantity: 2, status: "Assegnare", completed: false });
  });

  it("allows a volunteer assigned to the request to add an item", async () => {
    const result = await addDeviceRequestChecklistItem.run(
      buildRequest({ requestId: "req-1", title: "Verifica materiale", type: "generic" }, "volunteer-1")
    );

    expect(result).toHaveProperty("itemId");
  });

  it("denies adding an item to a volunteer not assigned to the request", async () => {
    await expect(
      addDeviceRequestChecklistItem.run(
        buildRequest({ requestId: "req-1", title: "Titolo" }, "volunteer-2")
      )
    ).rejects.toMatchObject(
      new HttpsError("permission-denied", "Only admin or assigned volunteers can access the checklist for this request")
    );

    expect(checklistUpdateMock).not.toHaveBeenCalled();
  });

  it("throws unauthenticated when there is no auth context", async () => {
    await expect(
      addDeviceRequestChecklistItem.run(buildRequest({ requestId: "req-1", title: "Titolo" }, null))
    ).rejects.toMatchObject(new HttpsError("unauthenticated", "User must be authenticated"));

    expect(collectionMock).not.toHaveBeenCalled();
  });

  it("throws invalid-argument when requestId is missing", async () => {
    await expect(
      addDeviceRequestChecklistItem.run(buildRequest({ title: "Titolo" }, "admin-1"))
    ).rejects.toMatchObject(new HttpsError("invalid-argument", "Missing parameter: requestId"));

    expect(checklistUpdateMock).not.toHaveBeenCalled();
  });

  it("propagates invalid-argument from the core addChecklistItem when title is missing", async () => {
    await expect(
      addDeviceRequestChecklistItem.run(buildRequest({ requestId: "req-1" }, "admin-1"))
    ).rejects.toMatchObject(new HttpsError("invalid-argument", "Missing title"));

    expect(checklistUpdateMock).not.toHaveBeenCalled();
  });
});
