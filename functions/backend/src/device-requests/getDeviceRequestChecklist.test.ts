import { HttpsError } from "firebase-functions/v2/https";
import type { CallableRequest } from "firebase-functions/v2/https";

const CHECKLIST_ID = "checklist-1";

/**
 * Store in-memory minimale che simula le collection Firestore coinvolte:
 * `users` (RBAC), `deviceRequests` (risoluzione `requestId` ->
 * `checklistId` + `assignedVolunteers`) e `checklists` (lettura delegata
 * al core Organizer `getChecklist`).
 */
let usersStore: Record<string, Record<string, unknown> | undefined>;
let deviceRequestsStore: Record<string, Record<string, unknown> | undefined>;
let checklistsStore: Record<string, Record<string, unknown> | undefined>;

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

  throw new Error(`Unexpected collection ${name}`);
}

const collectionMock = jest.fn((name: string) => buildCollection(name));

jest.mock("firebase-admin/firestore", () => ({
  getFirestore: jest.fn(() => ({
    collection: (name: string) => collectionMock(name),
  })),
}));

import { getDeviceRequestChecklist } from "./getDeviceRequestChecklist";

function buildRequest(data: Record<string, unknown>, uid: string | null = "admin-1"): CallableRequest {
  return {
    auth: uid ? ({ uid } as CallableRequest["auth"]) : undefined,
    data,
    rawRequest: { headers: {} } as CallableRequest["rawRequest"],
  } as CallableRequest;
}

describe("getDeviceRequestChecklist", () => {
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
      "req-no-checklist": {
        assignedVolunteers: ["volunteer-1"],
      },
    };

    checklistsStore = {
      [CHECKLIST_ID]: {
        category: "Kinetic Hand",
        title: "Checklist di fabbricazione",
        items: [
          {
            id: "item-1",
            title: "Prepara stampante",
            assignee: null,
            quantity: 2,
            notes: "",
            status: "Assegnare",
            completed: false,
          },
        ],
        createdAt: { seconds: 1, nanoseconds: 0 },
        updatedAt: { seconds: 2, nanoseconds: 0 },
      },
    };
  });

  it("returns the checklist for an admin, for any request", async () => {
    const result = await getDeviceRequestChecklist.run(buildRequest({ requestId: "req-1" }, "admin-1"));

    expect(result).toEqual({
      checklistId: CHECKLIST_ID,
      category: "Kinetic Hand",
      title: "Checklist di fabbricazione",
      items: checklistsStore[CHECKLIST_ID]?.items,
      createdAt: checklistsStore[CHECKLIST_ID]?.createdAt,
      updatedAt: checklistsStore[CHECKLIST_ID]?.updatedAt,
    });
  });

  it("returns the checklist for a volunteer assigned to the request", async () => {
    const result = await getDeviceRequestChecklist.run(buildRequest({ requestId: "req-1" }, "volunteer-1"));

    expect(result.checklistId).toBe(CHECKLIST_ID);
  });

  it("denies access to a volunteer not assigned to the request", async () => {
    await expect(
      getDeviceRequestChecklist.run(buildRequest({ requestId: "req-1" }, "volunteer-2"))
    ).rejects.toMatchObject(
      new HttpsError("permission-denied", "Only admin or assigned volunteers can access the checklist for this request")
    );
  });

  it("throws not-found when the device request does not exist", async () => {
    await expect(
      getDeviceRequestChecklist.run(buildRequest({ requestId: "missing-request" }, "admin-1"))
    ).rejects.toMatchObject(new HttpsError("not-found", "Device request not found"));
  });

  it("throws not-found when the device request has no checklist linked", async () => {
    await expect(
      getDeviceRequestChecklist.run(buildRequest({ requestId: "req-no-checklist" }, "volunteer-1"))
    ).rejects.toMatchObject(new HttpsError("not-found", "No checklist linked to this device request"));
  });

  it("throws unauthenticated when there is no auth context", async () => {
    await expect(
      getDeviceRequestChecklist.run(buildRequest({ requestId: "req-1" }, null))
    ).rejects.toMatchObject(new HttpsError("unauthenticated", "User must be authenticated"));

    expect(collectionMock).not.toHaveBeenCalled();
  });

  it("throws invalid-argument when requestId is missing", async () => {
    await expect(
      getDeviceRequestChecklist.run(buildRequest({}, "admin-1"))
    ).rejects.toMatchObject(new HttpsError("invalid-argument", "Missing parameter: requestId"));

    expect(collectionMock).not.toHaveBeenCalled();
  });
});
