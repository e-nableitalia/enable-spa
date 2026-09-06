import { HttpsError } from "firebase-functions/v2/https";
import type { CallableRequest } from "firebase-functions/v2/https";

const SIGNED_URL = "https://storage.googleapis.com/enableitalia-attachments/signed-download-url";

let usersStore: Record<string, Record<string, unknown> | undefined>;

const getAttachmentByIdMock = jest.fn();
jest.mock("./attachmentModel", () => ({
  getAttachmentById: (...args: unknown[]) => getAttachmentByIdMock(...args),
}));

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
  throw new Error(`Unexpected collection requested in test: ${name}`);
}

const collectionMock = jest.fn((name: string) => buildCollection(name));

jest.mock("firebase-admin/firestore", () => ({
  getFirestore: jest.fn(() => ({
    collection: (name: string) => collectionMock(name),
  })),
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

import { downloadAttachment } from "./downloadAttachment";

function buildRequest(data: Record<string, unknown>, uid: string | null = "admin-1"): CallableRequest {
  return {
    auth: uid ? ({ uid, token: { email: `${uid}@example.org` } } as CallableRequest["auth"]) : undefined,
    data,
    rawRequest: { headers: {} } as CallableRequest["rawRequest"],
  } as CallableRequest;
}

function baseData(overrides: Record<string, unknown> = {}) {
  return {
    attachmentId: "att-1",
    ...overrides,
  };
}

const SAMPLE_ATTACHMENT = {
  id: "att-1",
  entityType: "deviceRequest",
  entityId: "request-42",
  uploadedBy: "admin-1",
  description: "Fattura di acquisto",
  fileName: "fattura.pdf",
  extension: "pdf",
  storagePath: "attachments/deviceRequest/request-42/att-1/fattura.pdf",
  size: 1024,
};

describe("downloadAttachment", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getSignedUrlMock.mockResolvedValue([SIGNED_URL]);
    usersStore = {
      "admin-1": { role: "admin" },
      "volunteer-1": { role: "volunteer" },
      "organizer-1": { role: "organizer" },
      "no-role-1": {},
    };
    getAttachmentByIdMock.mockResolvedValue(SAMPLE_ATTACHMENT);
  });

  // Scenario 1: Admin scarica un allegato
  it("lets an admin download an attachment and returns a short-lived signed download URL", async () => {
    const result = await downloadAttachment.run(buildRequest(baseData(), "admin-1"));

    expect(result).toEqual({
      attachmentId: "att-1",
      downloadUrl: SIGNED_URL,
      fileName: "fattura.pdf",
    });

    expect(getAttachmentByIdMock).toHaveBeenCalledWith(expect.anything(), "att-1");
    expect(bucketMock).toHaveBeenCalledWith("enableitalia-staging-attachments");
    expect(fileMock).toHaveBeenCalledWith("attachments/deviceRequest/request-42/att-1/fattura.pdf");
    expect(getSignedUrlMock).toHaveBeenCalledWith(
      expect.objectContaining({ version: "v4", action: "read" })
    );
  });

  // Scenario 2: Volontario scarica un allegato — stesso esito di successo, nessuna differenziazione di ownership
  it("lets a volunteer download the same attachment with the same successful outcome as an admin", async () => {
    const result = await downloadAttachment.run(buildRequest(baseData(), "volunteer-1"));

    expect(result).toEqual({
      attachmentId: "att-1",
      downloadUrl: SIGNED_URL,
      fileName: "fattura.pdf",
    });
  });

  // Scenario 3: Utente non-staff nega il download
  it("denies the download to an organizer (non-staff role) and generates no signed URL", async () => {
    await expect(downloadAttachment.run(buildRequest(baseData(), "organizer-1"))).rejects.toMatchObject(
      new HttpsError("permission-denied", "Only staff (admin or volunteer) can download attachments")
    );

    expect(getAttachmentByIdMock).not.toHaveBeenCalled();
    expect(getSignedUrlMock).not.toHaveBeenCalled();
  });

  it("denies the download to an authenticated user with no staff role at all and generates no signed URL", async () => {
    await expect(downloadAttachment.run(buildRequest(baseData(), "no-role-1"))).rejects.toMatchObject(
      new HttpsError("permission-denied", "Only staff (admin or volunteer) can download attachments")
    );

    expect(getSignedUrlMock).not.toHaveBeenCalled();
  });

  it("denies the download to an unauthenticated caller and generates no signed URL", async () => {
    await expect(downloadAttachment.run(buildRequest(baseData(), null))).rejects.toMatchObject(
      new HttpsError("unauthenticated", "Authentication required")
    );

    expect(getAttachmentByIdMock).not.toHaveBeenCalled();
    expect(getSignedUrlMock).not.toHaveBeenCalled();
  });

  // Scenario 4: Logging della sola emissione, non del completamento
  it("logs a single success event recording the signed URL issuance, with no separate begin/complete download tracking", async () => {
    await downloadAttachment.run(buildRequest(baseData(), "admin-1"));

    expect(logSecurityEventMock).toHaveBeenCalledTimes(1);
    expect(logSecurityEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "downloadAttachment",
        outcome: "success",
        actor: expect.objectContaining({ uid: "admin-1" }),
        context: expect.objectContaining({
          metadata: expect.objectContaining({ attachmentId: "att-1" }),
        }),
      })
    );
  });

  it("logs a blocked event when a non-staff user is denied", async () => {
    await expect(downloadAttachment.run(buildRequest(baseData(), "organizer-1"))).rejects.toThrow();

    expect(logSecurityEventMock).toHaveBeenCalledTimes(1);
    expect(logSecurityEventMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: "downloadAttachment", outcome: "blocked" })
    );
  });

  it("logs a blocked event for an unauthenticated call", async () => {
    await expect(downloadAttachment.run(buildRequest(baseData(), null))).rejects.toThrow();

    expect(logSecurityEventMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: "downloadAttachment", outcome: "blocked" })
    );
  });

  // Regressione: contratto di validazione argomenti di base
  it("throws invalid-argument when attachmentId is missing", async () => {
    await expect(
      downloadAttachment.run(buildRequest(baseData({ attachmentId: undefined }), "admin-1"))
    ).rejects.toMatchObject(
      new HttpsError("invalid-argument", "Missing or invalid parameter: attachmentId")
    );

    expect(getAttachmentByIdMock).not.toHaveBeenCalled();
  });

  it("logs a blocked event when attachmentId is missing", async () => {
    await expect(
      downloadAttachment.run(buildRequest(baseData({ attachmentId: undefined }), "admin-1"))
    ).rejects.toThrow();

    expect(logSecurityEventMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: "downloadAttachment", outcome: "blocked" })
    );
  });

  // Regressione: attachmentId che non referenzia alcun allegato esistente
  it("throws not-found and generates no signed URL when the attachment does not exist", async () => {
    getAttachmentByIdMock.mockResolvedValue(null);

    await expect(downloadAttachment.run(buildRequest(baseData(), "admin-1"))).rejects.toMatchObject(
      new HttpsError("not-found", "Attachment not found")
    );

    expect(getSignedUrlMock).not.toHaveBeenCalled();
    expect(logSecurityEventMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: "downloadAttachment", outcome: "blocked" })
    );
  });

  // Regressione: errori infrastrutturali imprevisti non devono sfuggire al logging di sicurezza
  it("logs a failure event and throws internal when getSignedUrl throws unexpectedly", async () => {
    getSignedUrlMock.mockRejectedValueOnce(new Error("bucket does not exist"));

    await expect(downloadAttachment.run(buildRequest(baseData(), "admin-1"))).rejects.toMatchObject(
      new HttpsError("internal", "Internal Server Error")
    );

    expect(logSecurityEventMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: "downloadAttachment", outcome: "failure" })
    );
  });
});
