import { HttpsError } from "firebase-functions/v2/https";
import type { CallableRequest } from "firebase-functions/v2/https";

const SERVER_TIMESTAMP_SENTINEL = { __type: "serverTimestamp" };
const SIGNED_URL = "https://storage.googleapis.com/enableitalia-staging-attachments/signed-upload-url";

let usersStore: Record<string, Record<string, unknown> | undefined>;
let deviceRequestsStore: Record<string, Record<string, unknown> | undefined>;
/** Documenti scritti in `attachments/{attachmentId}`. */
let attachmentsStore: Record<string, Record<string, unknown>>;
/** Documenti indice scritti in `deviceRequests/{requestId}/attachments/{attachmentId}`. */
let indexStore: Record<string, Record<string, Record<string, unknown>>>;

let attachmentIdCounter = 0;
function nextAttachmentId() {
  attachmentIdCounter += 1;
  return `generated-attachment-id-${attachmentIdCounter}`;
}

const batchSetMock = jest.fn(
  (ref: { __kind: string; id: string; entityId?: string }, doc: Record<string, unknown>) => {
    if (ref.__kind === "attachment") {
      attachmentsStore[ref.id] = doc;
    } else {
      const key = ref.entityId as string;
      indexStore[key] = indexStore[key] ?? {};
      indexStore[key][ref.id] = doc;
    }
  }
);
const batchCommitMock = jest.fn().mockResolvedValue(undefined);

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
      doc: jest.fn((requestId: string) => ({
        get: jest.fn(() =>
          Promise.resolve({
            exists: deviceRequestsStore[requestId] !== undefined,
            data: () => deviceRequestsStore[requestId],
          })
        ),
        collection: jest.fn((subName: string) => {
          expect(subName).toBe("attachments");
          return {
            doc: jest.fn((attachmentId: string) => ({
              __kind: "index" as const,
              id: attachmentId,
              entityId: requestId,
            })),
          };
        }),
      })),
    };
  }

  if (name === "attachments") {
    return {
      doc: jest.fn((attachmentId?: string) => {
        const id = attachmentId ?? nextAttachmentId();
        return {
          __kind: "attachment" as const,
          id,
          get: jest.fn(() =>
            Promise.resolve({
              exists: attachmentsStore[id] !== undefined,
              data: () => attachmentsStore[id],
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
    batch: jest.fn(() => ({ set: batchSetMock, commit: batchCommitMock })),
  })),
  FieldValue: {
    serverTimestamp: jest.fn(() => SERVER_TIMESTAMP_SENTINEL),
  },
}));

const getSignedUrlMock = jest.fn().mockResolvedValue([SIGNED_URL]);
const fileMock = jest.fn((path: string) => ({ getSignedUrl: getSignedUrlMock, path }));
const bucketMock = jest.fn((name: string) => ({ file: fileMock, name }));

jest.mock("firebase-admin/storage", () => ({
  getStorage: jest.fn(() => ({ bucket: bucketMock })),
}));

jest.mock("firebase-admin/app", () => ({
  getApp: jest.fn(() => ({ options: { projectId: "enableitalia-staging" } })),
}));

jest.mock("../security/securityLog", () => ({
  logSecurityEvent: jest.fn().mockResolvedValue(undefined),
}));

import { uploadDeviceRequestAttachment } from "./uploadDeviceRequestAttachment";

function buildRequest(data: Record<string, unknown>, uid: string | null = "admin-1"): CallableRequest {
  return {
    auth: uid ? ({ uid, token: { email: `${uid}@example.org` } } as CallableRequest["auth"]) : undefined,
    data,
    rawRequest: { headers: {} } as CallableRequest["rawRequest"],
  } as CallableRequest;
}

function baseData(overrides: Record<string, unknown> = {}) {
  return {
    requestId: "req-1",
    fileName: "fattura.pdf",
    description: "Fattura di acquisto",
    size: 1024,
    ...overrides,
  };
}

describe("uploadDeviceRequestAttachment", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getSignedUrlMock.mockResolvedValue([SIGNED_URL]);
    attachmentIdCounter = 0;

    usersStore = {
      "admin-1": { role: "admin" },
      "volunteer-1": { role: "volunteer" },
      "volunteer-2": { role: "volunteer" },
    };
    deviceRequestsStore = {
      "req-1": { assignedVolunteers: ["volunteer-1"] },
    };
    attachmentsStore = {};
    indexStore = {};
  });

  it("lets an admin upload an attachment linked to the device request, tagged entityType deviceRequest", async () => {
    const result = await uploadDeviceRequestAttachment.run(buildRequest(baseData(), "admin-1"));

    expect(result).toMatchObject({ uploadUrl: SIGNED_URL });
    const attachmentId = (result as { attachmentId: string }).attachmentId;
    expect(attachmentsStore[attachmentId]).toMatchObject({
      entityType: "deviceRequest",
      entityId: "req-1",
      entityCollectionPath: "deviceRequests",
      uploadedBy: "admin-1",
    });
    expect(indexStore["req-1"]?.[attachmentId]).toMatchObject({ attachmentId });
  });

  it("lets a volunteer assigned to the request upload an attachment", async () => {
    const result = await uploadDeviceRequestAttachment.run(buildRequest(baseData(), "volunteer-1"));

    expect(result).toHaveProperty("attachmentId");
  });

  it("denies upload to a volunteer not assigned to the request", async () => {
    await expect(
      uploadDeviceRequestAttachment.run(buildRequest(baseData(), "volunteer-2"))
    ).rejects.toMatchObject(
      new HttpsError(
        "permission-denied",
        "Only admin or assigned volunteers can access attachments for this request"
      )
    );

    expect(batchCommitMock).not.toHaveBeenCalled();
  });

  it("throws unauthenticated when there is no auth context", async () => {
    await expect(
      uploadDeviceRequestAttachment.run(buildRequest(baseData(), null))
    ).rejects.toMatchObject(new HttpsError("unauthenticated", "User must be authenticated"));

    expect(collectionMock).not.toHaveBeenCalled();
  });

  it("throws invalid-argument when requestId is missing", async () => {
    await expect(
      uploadDeviceRequestAttachment.run(buildRequest(baseData({ requestId: undefined }), "admin-1"))
    ).rejects.toMatchObject(new HttpsError("invalid-argument", "Missing parameter: requestId"));

    expect(batchCommitMock).not.toHaveBeenCalled();
  });

  it("throws not-found when the device request does not exist", async () => {
    await expect(
      uploadDeviceRequestAttachment.run(buildRequest(baseData({ requestId: "missing-req" }), "admin-1"))
    ).rejects.toMatchObject(new HttpsError("not-found", "Device request not found"));
  });

  // Verifica che la delega alla Cloud Function generica avvenga davvero
  // (non solo che il wrapper non lanci): un rifiuto della validazione
  // interna di uploadAttachment (descrizione mancante) deve propagarsi.
  it("propagates invalid-argument from the generic uploadAttachment when description is missing", async () => {
    await expect(
      uploadDeviceRequestAttachment.run(buildRequest(baseData({ description: "" }), "admin-1"))
    ).rejects.toMatchObject(new HttpsError("invalid-argument", "description is required"));

    expect(batchCommitMock).not.toHaveBeenCalled();
  });
});
