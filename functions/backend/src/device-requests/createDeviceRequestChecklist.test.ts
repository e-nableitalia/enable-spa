import { HttpsError } from "firebase-functions/v2/https";
import type { CallableRequest } from "firebase-functions/v2/https";

const GENERATED_CHECKLIST_ID = "generated-checklist-id";

/**
 * Store in-memory minimale che simula le collection Firestore coinvolte:
 * `users` (RBAC), `deviceRequests` (documento principale + back-reference
 * array `checklistIds`), `publicDeviceRequests` (fallback `devicetype`),
 * `templates` (catalogo da cui istanziare), `checklists` (scrittura della
 * nuova istanza, `items` come solo array di `itemId`, EA-137) e
 * `checklistItems` (un documento per ciascun item copiato dal template,
 * scrittura delegata al core Organizer `createChecklistFromTemplate`,
 * EA-139).
 */
let usersStore: Record<string, Record<string, unknown> | undefined>;
let deviceRequestsStore: Record<string, Record<string, unknown> | undefined>;
let publicDeviceRequestsStore: Record<string, Record<string, unknown> | undefined>;
let templatesStore: Record<string, Record<string, unknown> | undefined>;

const batchSetMock = jest.fn();
const batchCommitMock = jest.fn().mockResolvedValue(undefined);

let generatedItemCounter = 0;

function checklistItemDoc() {
  generatedItemCounter += 1;
  return { id: `generated-item-id-${generatedItemCounter}` };
}

const checklistItemDocMock = jest.fn(checklistItemDoc);

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

  if (name === "publicDeviceRequests") {
    return {
      doc: jest.fn((id: string) => ({
        get: jest.fn(() =>
          Promise.resolve({
            exists: publicDeviceRequestsStore[id] !== undefined,
            data: () => publicDeviceRequestsStore[id],
          })
        ),
      })),
    };
  }

  if (name === "templates") {
    return {
      doc: jest.fn((id: string) => ({
        get: jest.fn(() =>
          Promise.resolve({
            exists: templatesStore[id] !== undefined,
            data: () => templatesStore[id],
          })
        ),
      })),
      where: jest.fn((field: string, _op: string, value: unknown) => ({
        limit: jest.fn(() => ({
          get: jest.fn(() => {
            const matches = Object.entries(templatesStore).filter(
              ([, data]) => data !== undefined && (data as Record<string, unknown>)[field] === value
            );
            return Promise.resolve({
              empty: matches.length === 0,
              docs: matches.map(([id, data]) => ({ id, data: () => data })),
            });
          }),
        })),
      })),
    };
  }

  if (name === "checklists") {
    return {
      doc: jest.fn(() => ({ id: GENERATED_CHECKLIST_ID })),
    };
  }

  if (name === "checklistItems") {
    return { doc: checklistItemDocMock };
  }

  throw new Error(`Unexpected collection ${name}`);
}

const collectionMock = jest.fn((name: string) => buildCollection(name));

jest.mock("firebase-admin/firestore", () => ({
  getFirestore: jest.fn(() => ({
    collection: (name: string) => collectionMock(name),
    // createChecklist e createChecklistFromTemplate (organizer core, EA-137/EA-139)
    // scrivono la checklist e i suoi checklistItems via db.batch().set(ref, data):
    // qui batchSetMock registra ogni chiamata, distinta per ref.id (vedi
    // savedChecklistDocument()/savedItemDocuments() sotto), stesso pattern di
    // createChecklistFromTemplate.test.ts.
    batch: jest.fn(() => ({
      set: batchSetMock,
      commit: batchCommitMock,
    })),
  })),
  FieldValue: {
    serverTimestamp: jest.fn(() => "SERVER_TIMESTAMP"),
    arrayUnion: jest.fn((...values: unknown[]) => ({ __op: "arrayUnion", values })),
  },
}));

jest.mock("../security/securityLog", () => ({
  logSecurityEvent: jest.fn().mockResolvedValue(undefined),
}));

import { createDeviceRequestChecklist } from "./createDeviceRequestChecklist";

function buildRequest(data: Record<string, unknown>, uid: string | null = "admin-1"): CallableRequest {
  return {
    auth: uid ? ({ uid } as CallableRequest["auth"]) : undefined,
    data,
    rawRequest: { headers: {} } as CallableRequest["rawRequest"],
  } as CallableRequest;
}

function savedChecklistDocument() {
  const call = batchSetMock.mock.calls.find(([ref]: [{ id: string }]) => ref.id === GENERATED_CHECKLIST_ID);
  return call?.[1] as Record<string, unknown> | undefined;
}

function savedItemDocuments() {
  return batchSetMock.mock.calls
    .filter(([ref]: [{ id: string }]) => ref.id !== GENERATED_CHECKLIST_ID)
    .map(([, document]: [unknown, Record<string, unknown>]) => document);
}

describe("createDeviceRequestChecklist", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    generatedItemCounter = 0;

    usersStore = {
      "admin-1": { role: "admin" },
      "volunteer-1": { role: "volunteer" },
      "volunteer-2": { role: "volunteer" },
    };

    deviceRequestsStore = {
      "req-1": {
        requestNumber: "REQ-000001",
        deviceType: "Kinetic Hand",
        assignedVolunteers: ["volunteer-1"],
      },
      "req-2": {
        requestNumber: "REQ-000002",
        deviceType: "Guitar Pick",
        assignedVolunteers: [],
      },
      "req-with-existing-checklist": {
        requestNumber: "REQ-000003",
        deviceType: "Kinetic Hand",
        assignedVolunteers: [],
        checklistIds: ["existing-checklist-id"],
      },
      "req-no-devicetype": {
        requestNumber: "REQ-000004",
        assignedVolunteers: [],
      },
      "req-at-max-checklists": {
        requestNumber: "REQ-000005",
        deviceType: "Kinetic Hand",
        assignedVolunteers: [],
        checklistIds: ["c-1", "c-2", "c-3", "c-4", "c-5"],
      },
    };

    publicDeviceRequestsStore = {
      "req-no-devicetype": { devicetype: "Kinetic Hand" },
    };

    templatesStore = {
      "template-kinetic-hand": {
        category: "Kinetic Hand",
        title: "Template Kinetic Hand",
        items: [{ title: "Stampa dita", quantity: 2 }],
      },
    };
  });

  it("instantiates the checklist from the devicetype template and links checklistIds to the request (admin)", async () => {
    const result = await createDeviceRequestChecklist.run(buildRequest({ requestId: "req-1" }, "admin-1"));

    expect(collectionMock).toHaveBeenCalledWith("templates");
    expect(savedChecklistDocument()).toEqual(
      expect.objectContaining({
        category: "Kinetic Hand",
        fromTemplate: "template-kinetic-hand",
        items: [expect.any(String)],
      })
    );
    expect(savedItemDocuments()).toEqual([
      expect.objectContaining({ title: "Stampa dita", quantity: 2, status: "Assegnare", completed: false }),
    ]);
    expect(result).toEqual({ checklistId: GENERATED_CHECKLIST_ID });
    expect(deviceRequestsStore["req-1"]?.checklistIds).toEqual([GENERATED_CHECKLIST_ID]);
  });

  it("creates a blank checklist when no template matches the request's devicetype", async () => {
    const result = await createDeviceRequestChecklist.run(buildRequest({ requestId: "req-2" }, "admin-1"));

    const savedDocument = savedChecklistDocument();
    expect(savedDocument).toEqual(
      expect.objectContaining({
        category: "Guitar Pick",
        items: [],
      })
    );
    expect(savedDocument).not.toHaveProperty("fromTemplate");
    expect(savedItemDocuments()).toEqual([]);
    expect(result).toEqual({ checklistId: GENERATED_CHECKLIST_ID });
    expect(deviceRequestsStore["req-2"]?.checklistIds).toEqual([GENERATED_CHECKLIST_ID]);
  });

  it("falls back to publicDeviceRequests.devicetype when the main document has no deviceType", async () => {
    await createDeviceRequestChecklist.run(buildRequest({ requestId: "req-no-devicetype" }, "admin-1"));

    expect(collectionMock).toHaveBeenCalledWith("publicDeviceRequests");
    expect(savedChecklistDocument()).toEqual(
      expect.objectContaining({ category: "Kinetic Hand", fromTemplate: "template-kinetic-hand" })
    );
  });

  it("allows a volunteer assigned to the request to create the checklist", async () => {
    const result = await createDeviceRequestChecklist.run(buildRequest({ requestId: "req-1" }, "volunteer-1"));

    expect(result).toEqual({ checklistId: GENERATED_CHECKLIST_ID });
    expect(deviceRequestsStore["req-1"]?.checklistIds).toEqual([GENERATED_CHECKLIST_ID]);
  });

  it("denies creation to a volunteer not assigned to the request", async () => {
    await expect(
      createDeviceRequestChecklist.run(buildRequest({ requestId: "req-1" }, "volunteer-2"))
    ).rejects.toMatchObject(
      new HttpsError("permission-denied", "Only admin or assigned volunteers can create the checklist for this request")
    );

    expect(batchSetMock).not.toHaveBeenCalled();
    expect(deviceRequestsStore["req-1"]?.checklistIds).toBeUndefined();
  });

  it("denies creation to an authenticated user without a users/{uid} document", async () => {
    await expect(
      createDeviceRequestChecklist.run(buildRequest({ requestId: "req-1" }, "unknown-1"))
    ).rejects.toMatchObject(
      new HttpsError("permission-denied", "Only admin or assigned volunteers can create the checklist for this request")
    );

    expect(batchSetMock).not.toHaveBeenCalled();
  });

  it("throws unauthenticated when there is no auth context, without querying Firestore", async () => {
    await expect(
      createDeviceRequestChecklist.run(buildRequest({ requestId: "req-1" }, null))
    ).rejects.toMatchObject(new HttpsError("unauthenticated", "Authentication required"));

    expect(collectionMock).not.toHaveBeenCalled();
  });

  it("throws not-found when the device request does not exist", async () => {
    await expect(
      createDeviceRequestChecklist.run(buildRequest({ requestId: "missing-request" }, "admin-1"))
    ).rejects.toMatchObject(new HttpsError("not-found", "Device request not found"));

    expect(batchSetMock).not.toHaveBeenCalled();
  });

  it("adds an additional checklist via arrayUnion when the request already has one, without removing existing ids", async () => {
    const result = await createDeviceRequestChecklist.run(
      buildRequest({ requestId: "req-with-existing-checklist" }, "admin-1")
    );

    expect(result).toEqual({ checklistId: GENERATED_CHECKLIST_ID });
    expect(deviceRequestsStore["req-with-existing-checklist"]?.checklistIds).toEqual([
      "existing-checklist-id",
      GENERATED_CHECKLIST_ID,
    ]);
  });

  it("throws failed-precondition and does not modify checklistIds when the request already has the maximum number of checklists", async () => {
    await expect(
      createDeviceRequestChecklist.run(buildRequest({ requestId: "req-at-max-checklists" }, "admin-1"))
    ).rejects.toMatchObject(
      new HttpsError(
        "failed-precondition",
        "This device request already has the maximum number of checklists (5)"
      )
    );

    expect(batchSetMock).not.toHaveBeenCalled();
    expect(deviceRequestsStore["req-at-max-checklists"]?.checklistIds).toEqual([
      "c-1",
      "c-2",
      "c-3",
      "c-4",
      "c-5",
    ]);
  });

  it("throws invalid-argument when requestId is missing", async () => {
    await expect(createDeviceRequestChecklist.run(buildRequest({}, "admin-1"))).rejects.toMatchObject(
      new HttpsError("invalid-argument", "Missing or invalid requestId")
    );

    expect(batchSetMock).not.toHaveBeenCalled();
  });

  it("uses the provided title instead of the default one", async () => {
    await createDeviceRequestChecklist.run(
      buildRequest({ requestId: "req-2", title: "Checklist custom" }, "admin-1")
    );

    expect(savedChecklistDocument()).toEqual(
      expect.objectContaining({ title: "Checklist custom" })
    );
  });

  it("generates a default title from the requestNumber when title is omitted", async () => {
    await createDeviceRequestChecklist.run(buildRequest({ requestId: "req-2" }, "admin-1"));

    expect(savedChecklistDocument()).toEqual(
      expect.objectContaining({ title: "Checklist di fabbricazione - REQ-000002" })
    );
  });
});
