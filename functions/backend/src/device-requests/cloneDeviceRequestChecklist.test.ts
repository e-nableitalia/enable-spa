import { HttpsError } from "firebase-functions/v2/https";
import type { CallableRequest } from "firebase-functions/v2/https";

const GENERATED_CHECKLIST_ID = "generated-checklist-id";

/**
 * Store in-memory minimale che simula le collection Firestore coinvolte:
 * `users` (RBAC sulla richiesta di destinazione), `deviceRequests`
 * (documento principale della richiesta di destinazione e della sorgente,
 * con back-reference array `checklistIds`) e `checklists` (lettura della
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
  FieldValue: {
    serverTimestamp: jest.fn(() => "SERVER_TIMESTAMP"),
    arrayUnion: jest.fn((...values: unknown[]) => ({ __op: "arrayUnion", values })),
  },
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
      "req-target-with-existing-checklist": {
        requestNumber: "REQ-000011",
        deviceType: "Kinetic Hand",
        assignedVolunteers: [],
        checklistIds: ["existing-checklist-id"],
      },
      "req-target-at-max-checklists": {
        requestNumber: "REQ-000012",
        deviceType: "Kinetic Hand",
        assignedVolunteers: [],
        checklistIds: ["c-1", "c-2", "c-3", "c-4", "c-5"],
      },
      "req-source-same-type": {
        requestNumber: "REQ-000020",
        deviceType: "Kinetic Hand",
        assignedVolunteers: [],
        checklistIds: ["source-checklist-same-type"],
      },
      "req-source-other-type": {
        requestNumber: "REQ-000021",
        deviceType: "Guitar Pick",
        assignedVolunteers: [],
        checklistIds: ["source-checklist-other-type"],
      },
      "req-source-no-checklist": {
        requestNumber: "REQ-000022",
        deviceType: "Kinetic Hand",
        assignedVolunteers: [],
      },
      "req-source-multi": {
        requestNumber: "REQ-000023",
        deviceType: "Kinetic Hand",
        assignedVolunteers: [],
        checklistIds: ["source-checklist-same-type", "source-checklist-other-type"],
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
      buildRequest(
        { requestId: "req-target", sourceRequestId: "req-source-same-type", sourceChecklistId: "source-checklist-same-type" },
        "admin-1"
      )
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
    expect(deviceRequestsStore["req-target"]?.checklistIds).toEqual([GENERATED_CHECKLIST_ID]);
  });

  it("clones freely from a source request of a different devicetype, without category restriction", async () => {
    const result = await cloneDeviceRequestChecklist.run(
      buildRequest(
        { requestId: "req-target", sourceRequestId: "req-source-other-type", sourceChecklistId: "source-checklist-other-type" },
        "admin-1"
      )
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
    expect(deviceRequestsStore["req-target"]?.checklistIds).toEqual([GENERATED_CHECKLIST_ID]);
  });

  it("clones the checklist referenced by an explicit sourceChecklistId, not necessarily the first one of a multi-checklist source", async () => {
    const result = await cloneDeviceRequestChecklist.run(
      buildRequest(
        { requestId: "req-target", sourceRequestId: "req-source-multi", sourceChecklistId: "source-checklist-other-type" },
        "admin-1"
      )
    );

    expect(checklistsSetMock).toHaveBeenCalledWith(
      expect.objectContaining({
        category: "Guitar Pick",
        clonedFrom: "source-checklist-other-type",
      })
    );
    expect(result).toEqual({ checklistId: GENERATED_CHECKLIST_ID });
  });

  it("allows a volunteer assigned to the target request to clone the checklist", async () => {
    const result = await cloneDeviceRequestChecklist.run(
      buildRequest(
        { requestId: "req-target", sourceRequestId: "req-source-same-type", sourceChecklistId: "source-checklist-same-type" },
        "volunteer-1"
      )
    );

    expect(result).toEqual({ checklistId: GENERATED_CHECKLIST_ID });
  });

  it("denies cloning to a volunteer not assigned to the target request", async () => {
    await expect(
      cloneDeviceRequestChecklist.run(
        buildRequest(
          { requestId: "req-target", sourceRequestId: "req-source-same-type", sourceChecklistId: "source-checklist-same-type" },
          "volunteer-2"
        )
      )
    ).rejects.toMatchObject(
      new HttpsError("permission-denied", "Only admin or assigned volunteers can clone a checklist for this request")
    );

    expect(checklistsSetMock).not.toHaveBeenCalled();
    expect(deviceRequestsStore["req-target"]?.checklistIds).toBeUndefined();
  });

  it("adds the cloned checklist via arrayUnion when the target already has a checklist, without removing existing ids", async () => {
    const result = await cloneDeviceRequestChecklist.run(
      buildRequest(
        {
          requestId: "req-target-with-existing-checklist",
          sourceRequestId: "req-source-same-type",
          sourceChecklistId: "source-checklist-same-type",
        },
        "admin-1"
      )
    );

    expect(result).toEqual({ checklistId: GENERATED_CHECKLIST_ID });
    expect(deviceRequestsStore["req-target-with-existing-checklist"]?.checklistIds).toEqual([
      "existing-checklist-id",
      GENERATED_CHECKLIST_ID,
    ]);
  });

  it("throws failed-precondition and does not modify checklistIds when the target already has the maximum number of checklists", async () => {
    await expect(
      cloneDeviceRequestChecklist.run(
        buildRequest(
          {
            requestId: "req-target-at-max-checklists",
            sourceRequestId: "req-source-same-type",
            sourceChecklistId: "source-checklist-same-type",
          },
          "admin-1"
        )
      )
    ).rejects.toMatchObject(
      new HttpsError(
        "failed-precondition",
        "This device request already has the maximum number of checklists (5)"
      )
    );

    expect(checklistsSetMock).not.toHaveBeenCalled();
    expect(deviceRequestsStore["req-target-at-max-checklists"]?.checklistIds).toEqual([
      "c-1",
      "c-2",
      "c-3",
      "c-4",
      "c-5",
    ]);
  });

  it("throws unauthenticated when there is no auth context, without querying Firestore", async () => {
    await expect(
      cloneDeviceRequestChecklist.run(
        buildRequest(
          { requestId: "req-target", sourceRequestId: "req-source-same-type", sourceChecklistId: "source-checklist-same-type" },
          null
        )
      )
    ).rejects.toMatchObject(new HttpsError("unauthenticated", "Authentication required"));

    expect(collectionMock).not.toHaveBeenCalled();
  });

  it("throws invalid-argument when requestId is missing", async () => {
    await expect(
      cloneDeviceRequestChecklist.run(
        buildRequest({ sourceRequestId: "req-source-same-type", sourceChecklistId: "source-checklist-same-type" }, "admin-1")
      )
    ).rejects.toMatchObject(new HttpsError("invalid-argument", "Missing or invalid requestId"));

    expect(checklistsSetMock).not.toHaveBeenCalled();
  });

  it("throws invalid-argument when sourceRequestId is missing", async () => {
    await expect(
      cloneDeviceRequestChecklist.run(
        buildRequest({ requestId: "req-target", sourceChecklistId: "source-checklist-same-type" }, "admin-1")
      )
    ).rejects.toMatchObject(new HttpsError("invalid-argument", "Missing or invalid sourceRequestId"));

    expect(checklistsSetMock).not.toHaveBeenCalled();
  });

  it("throws invalid-argument when sourceChecklistId is missing", async () => {
    await expect(
      cloneDeviceRequestChecklist.run(
        buildRequest({ requestId: "req-target", sourceRequestId: "req-source-same-type" }, "admin-1")
      )
    ).rejects.toMatchObject(new HttpsError("invalid-argument", "Missing or invalid sourceChecklistId"));

    expect(checklistsSetMock).not.toHaveBeenCalled();
  });

  it("throws not-found when the target device request does not exist", async () => {
    await expect(
      cloneDeviceRequestChecklist.run(
        buildRequest(
          { requestId: "missing-request", sourceRequestId: "req-source-same-type", sourceChecklistId: "source-checklist-same-type" },
          "admin-1"
        )
      )
    ).rejects.toMatchObject(new HttpsError("not-found", "Device request not found"));

    expect(checklistsSetMock).not.toHaveBeenCalled();
  });

  it("throws not-found when the source device request does not exist", async () => {
    await expect(
      cloneDeviceRequestChecklist.run(
        buildRequest(
          { requestId: "req-target", sourceRequestId: "missing-source", sourceChecklistId: "source-checklist-same-type" },
          "admin-1"
        )
      )
    ).rejects.toMatchObject(new HttpsError("not-found", "Source device request not found"));

    expect(checklistsSetMock).not.toHaveBeenCalled();
  });

  it("throws failed-precondition when the source device request has no checklists at all", async () => {
    await expect(
      cloneDeviceRequestChecklist.run(
        buildRequest(
          { requestId: "req-target", sourceRequestId: "req-source-no-checklist", sourceChecklistId: "some-checklist-id" },
          "admin-1"
        )
      )
    ).rejects.toMatchObject(
      new HttpsError("failed-precondition", "The source checklist is not linked to the source device request")
    );

    expect(checklistsSetMock).not.toHaveBeenCalled();
  });

  it("throws failed-precondition when sourceChecklistId does not belong to the source request's checklistIds", async () => {
    await expect(
      cloneDeviceRequestChecklist.run(
        buildRequest(
          { requestId: "req-target", sourceRequestId: "req-source-multi", sourceChecklistId: "not-a-source-checklist" },
          "admin-1"
        )
      )
    ).rejects.toMatchObject(
      new HttpsError("failed-precondition", "The source checklist is not linked to the source device request")
    );

    expect(checklistsSetMock).not.toHaveBeenCalled();
  });

  it("uses the provided title instead of the default one", async () => {
    await cloneDeviceRequestChecklist.run(
      buildRequest(
        {
          requestId: "req-target",
          sourceRequestId: "req-source-same-type",
          sourceChecklistId: "source-checklist-same-type",
          title: "Checklist custom",
        },
        "admin-1"
      )
    );

    expect(checklistsSetMock).toHaveBeenCalledWith(expect.objectContaining({ title: "Checklist custom" }));
  });

  it("generates a default title from the target request's requestNumber when title is omitted", async () => {
    await cloneDeviceRequestChecklist.run(
      buildRequest(
        { requestId: "req-target", sourceRequestId: "req-source-same-type", sourceChecklistId: "source-checklist-same-type" },
        "admin-1"
      )
    );

    expect(checklistsSetMock).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Checklist di fabbricazione - REQ-000010" })
    );
  });
});
