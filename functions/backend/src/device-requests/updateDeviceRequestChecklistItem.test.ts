import { HttpsError } from "firebase-functions/v2/https";
import type { CallableRequest } from "firebase-functions/v2/https";

const CHECKLIST_ID = "checklist-1";
const SERVER_TIMESTAMP_SENTINEL = { __type: "serverTimestamp" };

let usersStore: Record<string, Record<string, unknown> | undefined>;
let deviceRequestsStore: Record<string, Record<string, unknown> | undefined>;
let checklistsStore: Record<string, Record<string, unknown> | undefined>;
let checklistItemsStore: Record<string, Record<string, unknown> | undefined>;

const checklistItemUpdateMock = jest.fn((id: string, updates: Record<string, unknown>) => {
  checklistItemsStore[id] = { ...checklistItemsStore[id], ...updates };
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
      })),
    };
  }

  if (name === "checklistItems") {
    return {
      doc: jest.fn((id: string) => ({
        get: jest.fn(() =>
          Promise.resolve({
            exists: checklistItemsStore[id] !== undefined,
            data: () => checklistItemsStore[id],
          })
        ),
        update: jest.fn((updates: Record<string, unknown>) => checklistItemUpdateMock(id, updates)),
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

import { updateDeviceRequestChecklistItem } from "./updateDeviceRequestChecklistItem";

function buildRequest(data: Record<string, unknown>, uid: string | null = "admin-1"): CallableRequest {
  return {
    auth: uid ? ({ uid, token: { email: "user@example.com" } } as CallableRequest["auth"]) : undefined,
    data,
    rawRequest: { headers: {} } as CallableRequest["rawRequest"],
  } as CallableRequest;
}

describe("updateDeviceRequestChecklistItem", () => {
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
      [CHECKLIST_ID]: { items: ["item-1"] },
    };
    checklistItemsStore = {
      "item-1": {
        id: "item-1",
        checklistId: CHECKLIST_ID,
        title: "Prepara stampante",
        assignee: null,
        quantity: null,
        notes: "",
        status: "Assegnare",
        completed: false,
      },
    };
  });

  it("updates assignee, quantity, notes and status of an item (admin)", async () => {
    const result = await updateDeviceRequestChecklistItem.run(
      buildRequest(
        {
          requestId: "req-1",
          checklistId: CHECKLIST_ID,
          itemId: "item-1",
          assignee: "volunteer-1",
          quantity: 3,
          notes: "Materiale pronto",
          status: "In corso",
        },
        "admin-1"
      )
    );

    expect(result).toEqual({ success: true });
    expect(checklistItemsStore["item-1"]).toMatchObject({
      assignee: "volunteer-1",
      quantity: 3,
      notes: "Materiale pronto",
      status: "In corso",
    });
  });

  it("forwards and persists type when updating an item (admin)", async () => {
    const result = await updateDeviceRequestChecklistItem.run(
      buildRequest(
        {
          requestId: "req-1",
          checklistId: CHECKLIST_ID,
          itemId: "item-1",
          type: "numeric",
        },
        "admin-1"
      )
    );

    expect(result).toEqual({ success: true });
    expect(checklistItemsStore["item-1"]).toMatchObject({ type: "numeric" });
  });

  it("allows a volunteer assigned to the request to update an item", async () => {
    const result = await updateDeviceRequestChecklistItem.run(
      buildRequest(
        { requestId: "req-1", checklistId: CHECKLIST_ID, itemId: "item-1", status: "Da iniziare" },
        "volunteer-1"
      )
    );

    expect(result).toEqual({ success: true });
  });

  it("denies updating an item to a volunteer not assigned to the request", async () => {
    await expect(
      updateDeviceRequestChecklistItem.run(
        buildRequest(
          { requestId: "req-1", checklistId: CHECKLIST_ID, itemId: "item-1", status: "In corso" },
          "volunteer-2"
        )
      )
    ).rejects.toMatchObject(
      new HttpsError("permission-denied", "Only admin or assigned volunteers can access the checklist for this request")
    );

    expect(checklistItemUpdateMock).not.toHaveBeenCalled();
  });

  // Scenario 3 (EA-131): checklistId non appartenente a checklistIds -> not-found.
  it("throws not-found when checklistId does not belong to checklistIds of the request", async () => {
    await expect(
      updateDeviceRequestChecklistItem.run(
        buildRequest(
          { requestId: "req-1", checklistId: "other-checklist", itemId: "item-1", status: "In corso" },
          "admin-1"
        )
      )
    ).rejects.toMatchObject(new HttpsError("not-found", "Checklist not linked to this device request"));

    expect(checklistItemUpdateMock).not.toHaveBeenCalled();
  });

  // Scenario 5 (EA-133): nessun dual-read sul vecchio campo singolare
  // checklistId -> not-found, anche se il campo legacy e' ancora presente.
  it("throws not-found for a legacy request with only the singular checklistId field, no fallback", async () => {
    await expect(
      updateDeviceRequestChecklistItem.run(
        buildRequest(
          { requestId: "req-legacy", checklistId: CHECKLIST_ID, itemId: "item-1", status: "In corso" },
          "volunteer-1"
        )
      )
    ).rejects.toMatchObject(new HttpsError("not-found", "Checklist not linked to this device request"));
  });

  it("throws unauthenticated when there is no auth context", async () => {
    await expect(
      updateDeviceRequestChecklistItem.run(
        buildRequest({ requestId: "req-1", checklistId: CHECKLIST_ID, itemId: "item-1", status: "In corso" }, null)
      )
    ).rejects.toMatchObject(new HttpsError("unauthenticated", "User must be authenticated"));

    expect(collectionMock).not.toHaveBeenCalled();
  });

  it("throws invalid-argument when requestId is missing", async () => {
    await expect(
      updateDeviceRequestChecklistItem.run(
        buildRequest({ checklistId: CHECKLIST_ID, itemId: "item-1", status: "In corso" }, "admin-1")
      )
    ).rejects.toMatchObject(new HttpsError("invalid-argument", "Missing parameter: requestId"));

    expect(checklistItemUpdateMock).not.toHaveBeenCalled();
  });

  // Scenario 2 (EA-131): vecchio contratto (solo requestId, senza checklistId) -> invalid-argument.
  it("throws invalid-argument when checklistId is missing", async () => {
    await expect(
      updateDeviceRequestChecklistItem.run(
        buildRequest({ requestId: "req-1", itemId: "item-1", status: "In corso" }, "admin-1")
      )
    ).rejects.toMatchObject(new HttpsError("invalid-argument", "Missing parameter: checklistId"));

    expect(checklistItemUpdateMock).not.toHaveBeenCalled();
  });

  it("propagates invalid-argument from the core updateChecklistItem when itemId is missing", async () => {
    await expect(
      updateDeviceRequestChecklistItem.run(
        buildRequest({ requestId: "req-1", checklistId: CHECKLIST_ID, status: "In corso" }, "admin-1")
      )
    ).rejects.toMatchObject(new HttpsError("invalid-argument", "Missing itemId"));

    expect(checklistItemUpdateMock).not.toHaveBeenCalled();
  });
});
