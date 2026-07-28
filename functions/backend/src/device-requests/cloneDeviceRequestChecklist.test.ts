import { HttpsError } from "firebase-functions/v2/https";
import type { CallableRequest } from "firebase-functions/v2/https";

const GENERATED_CHECKLIST_ID = "generated-checklist-id";

/**
 * Store in-memory minimale che simula le collection Firestore coinvolte:
 * `users` (RBAC sulla richiesta di destinazione), `deviceRequests`
 * (documento principale della richiesta di destinazione e della sorgente,
 * con back-reference `checklistId`) e `checklists` (lettura della
 * checklist sorgente + scrittura della nuova istanza, delegata al core
 * Organizer `cloneChecklist`).
 */
let usersStore: Record<string, Record<string, unknown> | undefined>;
let deviceRequestsStore: Record<string, Record<string, unknown> | undefined>;
let checklistsStore: Record<string, Record<string, unknown> | undefined>;

const checklistsSetMock = jest.fn((doc: Record<string, unknown>) => {
  void doc;
  return Promise.resolve();
});
const deviceRequestUpdateMock = jest.fn((id: string, updates: Record<string, unknown>) => {
  deviceRequestsStore[id] = { ...deviceRequestsStore[id], ...updates };
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
        update: jest.fn((updates: Record<string, unknown>) => deviceRequestUpdateMock(id, updates)),
      })),
    };
  }

  if (name === "checklists") {
    return {
      doc: jest.fn((id?: string) => {
        if (id === undefined) {
          return { id: GENERATED_CHECKLIST_ID, set: checklistsSetMock };
        }
        return {
          get: jest.fn(() => {
            const data = checklistsStore[id];
            return Promise.resolve({ exists: data !== undefined, data: () => data });
          }),
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
  })),
  FieldValue: { serverTimestamp: jest.fn(() => "SERVER_TIMESTAMP") },
}));

jest.mock("../security/securityLog", () => ({
  logSecurityEvent: jest.fn().mockResolvedValue(undefined),
}));

import { cloneDeviceRequestChecklist } from "./cloneDeviceRequestChecklist";

function buildRequest(data: Record<string, unknown>, uid: string | null = "admin-1"): CallableRequest {
  return {
    auth: uid ? ({ uid } as CallableRequest["auth"]) : undefined,
    data,
    rawRequest: { headers: {} } as CallableRequest["rawRequest"],
  } as CallableRequest;
}

describe("cloneDeviceRequestChecklist", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    checklistsSetMock.mockResolvedValue(undefined);

    usersStore = {
      "admin-1": { role: "admin" },
      "volunteer-1": { role: "volunteer" },
      "volunteer-2": { role: "volunteer" },
    };

    deviceRequestsStore = {
      "req-target": {
        requestNumber: "REQ-000010",
        deviceType: "Kinetic Hand",
        assignedVolunteers: ["volunteer-1"],
      },
      "req-target-already-linked": {
        requestNumber: "REQ-000011",
        deviceType: "Kinetic Hand",
        assignedVolunteers: [],
        checklistId: "existing-checklist-id",
      },
      "req-source-same-type": {
        requestNumber: "REQ-000020",
        deviceType: "Kinetic Hand",
        assignedVolunteers: [],
        checklistId: "source-checklist-same-type",
      },
      "req-source-other-type": {
        requestNumber: "REQ-000021",
        deviceType: "Guitar Pick",
        assignedVolunteers: [],
        checklistId: "source-checklist-other-type",
      },
      "req-source-no-checklist": {
        requestNumber: "REQ-000022",
        deviceType: "Kinetic Hand",
        assignedVolunteers: [],
      },
    };

    checklistsStore = {
      "source-checklist-same-type": {
        category: "Kinetic Hand",
        title: "Checklist evento passato",
        items: [
          { id: "item-1", title: "Stampa dita", assignee: "vol-9", quantity: 2, notes: "vecchia nota", status: "Completata", completed: true },
        ],
      },
      "source-checklist-other-type": {
        category: "Guitar Pick",
        title: "Checklist plettro",
        items: [
          { id: "item-2", title: "Taglia plettro", assignee: null, quantity: 5, notes: "", status: "Da iniziare", completed: false },
        ],
      },
    };
  });

  it("clones the checklist from a source request of the same devicetype and links it to the target request", async () => {
    const result = await cloneDeviceRequestChecklist.run(
      buildRequest({ requestId: "req-target", sourceRequestId: "req-source-same-type" }, "admin-1")
    );

    expect(checklistsSetMock).toHaveBeenCalledWith(
      expect.objectContaining({
        category: "Kinetic Hand",
        clonedFrom: "source-checklist-same-type",
        items: [
          expect.objectContaining({ title: "Stampa dita", quantity: 2, assignee: null, status: "Assegnare", completed: false }),
        ],
      })
    );
    expect(result).toEqual({ checklistId: GENERATED_CHECKLIST_ID });
    expect(deviceRequestsStore["req-target"]?.checklistId).toBe(GENERATED_CHECKLIST_ID);
  });

  it("clones freely from a source request of a different devicetype, without category restriction", async () => {
    const result = await cloneDeviceRequestChecklist.run(
      buildRequest({ requestId: "req-target", sourceRequestId: "req-source-other-type" }, "admin-1")
    );

    expect(checklistsSetMock).toHaveBeenCalledWith(
      expect.objectContaining({
        category: "Guitar Pick",
        clonedFrom: "source-checklist-other-type",
        items: [
          expect.objectContaining({ title: "Taglia plettro", quantity: 5, status: "Assegnare", completed: false }),
        ],
      })
    );
    expect(result).toEqual({ checklistId: GENERATED_CHECKLIST_ID });
    expect(deviceRequestsStore["req-target"]?.checklistId).toBe(GENERATED_CHECKLIST_ID);
  });

  it("allows a volunteer assigned to the target request to clone the checklist", async () => {
    const result = await cloneDeviceRequestChecklist.run(
      buildRequest({ requestId: "req-target", sourceRequestId: "req-source-same-type" }, "volunteer-1")
    );

    expect(result).toEqual({ checklistId: GENERATED_CHECKLIST_ID });
  });

  it("denies cloning to a volunteer not assigned to the target request", async () => {
    await expect(
      cloneDeviceRequestChecklist.run(
        buildRequest({ requestId: "req-target", sourceRequestId: "req-source-same-type" }, "volunteer-2")
      )
    ).rejects.toMatchObject(
      new HttpsError("permission-denied", "Only admin or assigned volunteers can clone a checklist for this request")
    );

    expect(checklistsSetMock).not.toHaveBeenCalled();
    expect(deviceRequestsStore["req-target"]?.checklistId).toBeUndefined();
  });

  it("rejects cloning onto a target request that already has a checklistId", async () => {
    await expect(
      cloneDeviceRequestChecklist.run(
        buildRequest(
          { requestId: "req-target-already-linked", sourceRequestId: "req-source-same-type" },
          "admin-1"
        )
      )
    ).rejects.toMatchObject(
      new HttpsError("already-exists", "A checklist is already linked to this device request")
    );

    expect(checklistsSetMock).not.toHaveBeenCalled();
    expect(deviceRequestsStore["req-target-already-linked"]?.checklistId).toBe("existing-checklist-id");
  });

  it("throws unauthenticated when there is no auth context, without querying Firestore", async () => {
    await expect(
      cloneDeviceRequestChecklist.run(
        buildRequest({ requestId: "req-target", sourceRequestId: "req-source-same-type" }, null)
      )
    ).rejects.toMatchObject(new HttpsError("unauthenticated", "Authentication required"));

    expect(collectionMock).not.toHaveBeenCalled();
  });

  it("throws invalid-argument when requestId is missing", async () => {
    await expect(
      cloneDeviceRequestChecklist.run(buildRequest({ sourceRequestId: "req-source-same-type" }, "admin-1"))
    ).rejects.toMatchObject(new HttpsError("invalid-argument", "Missing or invalid requestId"));

    expect(checklistsSetMock).not.toHaveBeenCalled();
  });

  it("throws invalid-argument when sourceRequestId is missing", async () => {
    await expect(
      cloneDeviceRequestChecklist.run(buildRequest({ requestId: "req-target" }, "admin-1"))
    ).rejects.toMatchObject(new HttpsError("invalid-argument", "Missing or invalid sourceRequestId"));

    expect(checklistsSetMock).not.toHaveBeenCalled();
  });

  it("throws not-found when the target device request does not exist", async () => {
    await expect(
      cloneDeviceRequestChecklist.run(
        buildRequest({ requestId: "missing-request", sourceRequestId: "req-source-same-type" }, "admin-1")
      )
    ).rejects.toMatchObject(new HttpsError("not-found", "Device request not found"));

    expect(checklistsSetMock).not.toHaveBeenCalled();
  });

  it("throws not-found when the source device request does not exist", async () => {
    await expect(
      cloneDeviceRequestChecklist.run(
        buildRequest({ requestId: "req-target", sourceRequestId: "missing-source" }, "admin-1")
      )
    ).rejects.toMatchObject(new HttpsError("not-found", "Source device request not found"));

    expect(checklistsSetMock).not.toHaveBeenCalled();
  });

  it("throws failed-precondition when the source device request has no checklist to clone from", async () => {
    await expect(
      cloneDeviceRequestChecklist.run(
        buildRequest({ requestId: "req-target", sourceRequestId: "req-source-no-checklist" }, "admin-1")
      )
    ).rejects.toMatchObject(
      new HttpsError("failed-precondition", "Source device request has no checklist to clone from")
    );

    expect(checklistsSetMock).not.toHaveBeenCalled();
  });

  it("uses the provided title instead of the default one", async () => {
    await cloneDeviceRequestChecklist.run(
      buildRequest(
        { requestId: "req-target", sourceRequestId: "req-source-same-type", title: "Checklist custom" },
        "admin-1"
      )
    );

    expect(checklistsSetMock).toHaveBeenCalledWith(expect.objectContaining({ title: "Checklist custom" }));
  });

  it("generates a default title from the target request's requestNumber when title is omitted", async () => {
    await cloneDeviceRequestChecklist.run(
      buildRequest({ requestId: "req-target", sourceRequestId: "req-source-same-type" }, "admin-1")
    );

    expect(checklistsSetMock).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Checklist di fabbricazione - REQ-000010" })
    );
  });
});
