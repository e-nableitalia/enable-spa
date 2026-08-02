import { HttpsError } from "firebase-functions/v2/https";
import type { CallableRequest } from "firebase-functions/v2/https";

const CHECKLIST_ID = "checklist-1";

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

jest.mock("../security/securityLog", () => ({
  logSecurityEvent: jest.fn().mockResolvedValue(undefined),
}));

import { getDeviceRequestChecklistCompleteness } from "./getDeviceRequestChecklistCompleteness";

function buildRequest(data: Record<string, unknown>, uid: string | null = "admin-1"): CallableRequest {
  return {
    auth: uid ? ({ uid } as CallableRequest["auth"]) : undefined,
    data,
    rawRequest: { headers: {} } as CallableRequest["rawRequest"],
  } as CallableRequest;
}

describe("getDeviceRequestChecklistCompleteness", () => {
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
  });

  // EA-127: calcolo type-aware, item senza `type` trattati come 'generic'
  // (completo solo con status 'Completata').
  it("returns complete=true when all items of the checklist are complete", async () => {
    checklistsStore = {
      [CHECKLIST_ID]: {
        items: [
          { assignee: "volunteer-1", quantity: 2, status: "Completata" },
        ],
      },
    };

    const result = await getDeviceRequestChecklistCompleteness.run(
      buildRequest({ requestId: "req-1" }, "admin-1")
    );

    expect(result).toEqual({ checklistId: CHECKLIST_ID, complete: true });
  });

  // EA-127 (fix del bug): un item generic ancora 'In corso' non è completo.
  it("returns complete=false when at least one item is still incomplete", async () => {
    checklistsStore = {
      [CHECKLIST_ID]: {
        items: [
          { assignee: "volunteer-1", quantity: 2, status: "In corso" },
          { assignee: null, quantity: null, status: "Assegnare" },
        ],
      },
    };

    const result = await getDeviceRequestChecklistCompleteness.run(
      buildRequest({ requestId: "req-1" }, "volunteer-1")
    );

    expect(result).toEqual({ checklistId: CHECKLIST_ID, complete: false });
  });

  it("denies access to a volunteer not assigned to the request", async () => {
    checklistsStore = { [CHECKLIST_ID]: { items: [] } };

    await expect(
      getDeviceRequestChecklistCompleteness.run(buildRequest({ requestId: "req-1" }, "volunteer-2"))
    ).rejects.toMatchObject(
      new HttpsError("permission-denied", "Only admin or assigned volunteers can access the checklist for this request")
    );
  });

  it("throws unauthenticated when there is no auth context", async () => {
    await expect(
      getDeviceRequestChecklistCompleteness.run(buildRequest({ requestId: "req-1" }, null))
    ).rejects.toMatchObject(new HttpsError("unauthenticated", "User must be authenticated"));

    expect(collectionMock).not.toHaveBeenCalled();
  });

  it("throws invalid-argument when requestId is missing", async () => {
    await expect(
      getDeviceRequestChecklistCompleteness.run(buildRequest({}, "admin-1"))
    ).rejects.toMatchObject(new HttpsError("invalid-argument", "Missing parameter: requestId"));
  });
});
