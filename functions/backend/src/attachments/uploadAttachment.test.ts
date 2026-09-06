import { HttpsError } from "firebase-functions/v2/https";
import type { CallableRequest } from "firebase-functions/v2/https";

const SERVER_TIMESTAMP_SENTINEL = { __type: "serverTimestamp" };
const SIGNED_URL = "https://storage.googleapis.com/enableitalia-attachments/signed-upload-url";

let usersStore: Record<string, Record<string, unknown> | undefined>;
/** Documenti scritti in `attachments/{attachmentId}`, chiave = attachmentId. */
let attachmentsStore: Record<string, Record<string, unknown>>;
/** Documenti indice scritti in `{entityCollectionPath}/{entityId}/attachments/{attachmentId}`. */
let indexStore: Record<string, Record<string, Record<string, unknown>>>;

let attachmentIdCounter = 0;
function nextAttachmentId() {
  attachmentIdCounter += 1;
  return `generated-attachment-id-${attachmentIdCounter}`;
}

const batchSetMock = jest.fn(
  (ref: { __kind: string; id: string; entityId?: string; collectionPath?: string }, doc: Record<string, unknown>) => {
    if (ref.__kind === "attachment") {
      attachmentsStore[ref.id] = doc;
    } else {
      const key = `${ref.collectionPath}/${ref.entityId}`;
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

  if (name === "attachments") {
    return {
      doc: jest.fn((explicitId?: string) => ({
        id: explicitId ?? nextAttachmentId(),
        __kind: "attachment",
      })),
    };
  }

  // Collection dell'entità proprietaria (es. "deviceRequests"), opaca.
  return {
    doc: jest.fn((entityId: string) => ({
      collection: jest.fn((subName: string) => {
        expect(subName).toBe("attachments");
        return {
          doc: jest.fn((attachmentId: string) => ({
            id: attachmentId,
            entityId,
            collectionPath: name,
            __kind: "index",
          })),
        };
      }),
    })),
  };
}

const collectionMock = jest.fn((name: string) => buildCollection(name));

jest.mock("firebase-admin/firestore", () => ({
  getFirestore: jest.fn(() => ({
    collection: (name: string) => collectionMock(name),
    batch: jest.fn(() => ({ set: batchSetMock, commit: batchCommitMock })),
  })),
  FieldValue: { serverTimestamp: jest.fn(() => SERVER_TIMESTAMP_SENTINEL) },
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

const logSecurityEventMock = jest.fn().mockResolvedValue(undefined);
jest.mock("../security/securityLog", () => ({
  logSecurityEvent: (...args: unknown[]) => logSecurityEventMock(...args),
}));

import { uploadAttachment } from "./uploadAttachment";

function buildRequest(data: Record<string, unknown>, uid: string | null = "admin-1"): CallableRequest {
  return {
    auth: uid ? ({ uid, token: { email: `${uid}@example.org` } } as CallableRequest["auth"]) : undefined,
    data,
    rawRequest: { headers: {} } as CallableRequest["rawRequest"],
  } as CallableRequest;
}

function baseData(overrides: Record<string, unknown> = {}) {
  return {
    entityType: "deviceRequest",
    entityId: "request-42",
    entityCollectionPath: "deviceRequests",
    fileName: "fattura.pdf",
    description: "Fattura di acquisto",
    size: 1024,
    ...overrides,
  };
}

describe("uploadAttachment", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getSignedUrlMock.mockResolvedValue([SIGNED_URL]);
    attachmentIdCounter = 0;
    attachmentsStore = {};
    indexStore = {};
    usersStore = {
      "admin-1": { role: "admin" },
      "volunteer-1": { role: "volunteer" },
      "organizer-1": { role: "organizer" },
      "no-role-1": {},
    };
  });

  // Scenario 1: Admin carica un allegato
  it("lets an admin upload an attachment and returns a short-lived signed upload URL", async () => {
    const result = await uploadAttachment.run(buildRequest(baseData(), "admin-1"));

    expect(result).toEqual({
      attachmentId: "generated-attachment-id-1",
      uploadUrl: SIGNED_URL,
      storagePath: "attachments/deviceRequest/request-42/generated-attachment-id-1/fattura.pdf",
    });

    expect(getSignedUrlMock).toHaveBeenCalledWith(
      expect.objectContaining({ version: "v4", action: "write" })
    );
    expect(bucketMock).toHaveBeenCalledWith("enableitalia-staging-attachments");

    const attachmentDoc = attachmentsStore["generated-attachment-id-1"];
    expect(attachmentDoc).toMatchObject({
      entityType: "deviceRequest",
      entityId: "request-42",
      uploadedBy: "admin-1",
      description: "Fattura di acquisto",
      fileName: "fattura.pdf",
      extension: "pdf",
      storagePath: "attachments/deviceRequest/request-42/generated-attachment-id-1/fattura.pdf",
      size: 1024,
    });

    expect(indexStore["deviceRequests/request-42"]).toHaveProperty("generated-attachment-id-1");
  });

  // Scenario 2: Volontario carica un allegato — stesso esito di successo.
  it("lets a volunteer upload an attachment with the same successful outcome as an admin", async () => {
    const result = await uploadAttachment.run(buildRequest(baseData(), "volunteer-1"));

    expect(result).toEqual({
      attachmentId: "generated-attachment-id-1",
      uploadUrl: SIGNED_URL,
      storagePath: "attachments/deviceRequest/request-42/generated-attachment-id-1/fattura.pdf",
    });
    expect(attachmentsStore["generated-attachment-id-1"]).toMatchObject({ uploadedBy: "volunteer-1" });
  });

  // Scenario 3: Utente non-staff nega l'upload
  it("denies the upload to an organizer (non-staff role) and creates no record", async () => {
    await expect(uploadAttachment.run(buildRequest(baseData(), "organizer-1"))).rejects.toMatchObject(
      new HttpsError("permission-denied", "Only staff (admin or volunteer) can upload attachments")
    );

    expect(attachmentsStore).toEqual({});
    expect(batchCommitMock).not.toHaveBeenCalled();
    expect(getSignedUrlMock).not.toHaveBeenCalled();
  });

  it("denies the upload to an authenticated user with no staff role at all and creates no record", async () => {
    await expect(uploadAttachment.run(buildRequest(baseData(), "no-role-1"))).rejects.toMatchObject(
      new HttpsError("permission-denied", "Only staff (admin or volunteer) can upload attachments")
    );

    expect(attachmentsStore).toEqual({});
  });

  // Scenario 4: File oltre la dimensione massima consentita
  it("rejects a file above the maximum allowed size before generating any signed URL, creating no record", async () => {
    await expect(
      uploadAttachment.run(buildRequest(baseData({ size: 60 * 1024 * 1024 }), "admin-1"))
    ).rejects.toMatchObject(
      new HttpsError("failed-precondition", "File exceeds the maximum allowed size of 52428800 bytes")
    );

    expect(getSignedUrlMock).not.toHaveBeenCalled();
    expect(attachmentsStore).toEqual({});
    expect(batchCommitMock).not.toHaveBeenCalled();
  });

  // Scenario 5: Descrizione obbligatoria mancante
  it("rejects a missing description and creates no record", async () => {
    await expect(
      uploadAttachment.run(buildRequest(baseData({ description: undefined }), "admin-1"))
    ).rejects.toMatchObject(new HttpsError("invalid-argument", "description is required"));

    expect(getSignedUrlMock).not.toHaveBeenCalled();
    expect(attachmentsStore).toEqual({});
  });

  it("rejects a blank description and creates no record", async () => {
    await expect(
      uploadAttachment.run(buildRequest(baseData({ description: "   " }), "admin-1"))
    ).rejects.toMatchObject(new HttpsError("invalid-argument", "description is required"));

    expect(attachmentsStore).toEqual({});
  });

  // Scenario 6: Logging di ogni invocazione
  it("logs a success event consistent with the outcome when the upload succeeds", async () => {
    await uploadAttachment.run(buildRequest(baseData(), "admin-1"));

    expect(logSecurityEventMock).toHaveBeenCalledTimes(1);
    expect(logSecurityEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "uploadAttachment",
        outcome: "success",
        actor: expect.objectContaining({ uid: "admin-1" }),
      })
    );
  });

  it("logs a blocked event consistent with the outcome when a non-staff user is denied", async () => {
    await expect(uploadAttachment.run(buildRequest(baseData(), "organizer-1"))).rejects.toThrow();

    expect(logSecurityEventMock).toHaveBeenCalledTimes(1);
    expect(logSecurityEventMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: "uploadAttachment", outcome: "blocked" })
    );
  });

  it("logs a blocked event when the file size exceeds the limit", async () => {
    await expect(
      uploadAttachment.run(buildRequest(baseData({ size: 60 * 1024 * 1024 }), "admin-1"))
    ).rejects.toThrow();

    expect(logSecurityEventMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: "uploadAttachment", outcome: "blocked" })
    );
  });

  it("logs a blocked event when the description is missing", async () => {
    await expect(
      uploadAttachment.run(buildRequest(baseData({ description: "" }), "admin-1"))
    ).rejects.toThrow();

    expect(logSecurityEventMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: "uploadAttachment", outcome: "blocked" })
    );
  });

  it("logs a blocked event for an unauthenticated call", async () => {
    await expect(uploadAttachment.run(buildRequest(baseData(), null))).rejects.toMatchObject(
      new HttpsError("unauthenticated", "Authentication required")
    );

    expect(logSecurityEventMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: "uploadAttachment", outcome: "blocked" })
    );
  });

  // Test di regressione: contratto di validazione argomenti di base.
  it("throws invalid-argument when entityType is missing", async () => {
    await expect(
      uploadAttachment.run(buildRequest(baseData({ entityType: undefined }), "admin-1"))
    ).rejects.toMatchObject(new HttpsError("invalid-argument", "Missing or invalid parameter: entityType"));
  });

  it("throws invalid-argument when entityCollectionPath is missing", async () => {
    await expect(
      uploadAttachment.run(buildRequest(baseData({ entityCollectionPath: undefined }), "admin-1"))
    ).rejects.toMatchObject(
      new HttpsError("invalid-argument", "Missing or invalid parameter: entityCollectionPath")
    );
  });

  it("throws invalid-argument when size is not a positive number", async () => {
    await expect(
      uploadAttachment.run(buildRequest(baseData({ size: -5 }), "admin-1"))
    ).rejects.toMatchObject(new HttpsError("invalid-argument", "size must be a positive number"));
  });

  it("deduces the extension from fileName on the created attachment", async () => {
    await uploadAttachment.run(buildRequest(baseData({ fileName: "Foto.JPG" }), "admin-1"));

    expect(attachmentsStore["generated-attachment-id-1"]).toMatchObject({ extension: "jpg" });
  });
});
