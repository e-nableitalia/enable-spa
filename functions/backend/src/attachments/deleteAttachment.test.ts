import { HttpsError } from "firebase-functions/v2/https";
import type { CallableRequest } from "firebase-functions/v2/https";

let usersStore: Record<string, Record<string, unknown> | undefined>;

const getAttachmentByIdMock = jest.fn();
const deleteAttachmentRecordMock = jest.fn().mockResolvedValue(undefined);
jest.mock("./attachmentModel", () => ({
  getAttachmentById: (...args: unknown[]) => getAttachmentByIdMock(...args),
  deleteAttachmentRecord: (...args: unknown[]) => deleteAttachmentRecordMock(...args),
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

const fileDeleteMock = jest.fn().mockResolvedValue(undefined);
const fileMock = jest.fn((path: string) => ({ delete: fileDeleteMock, path }));
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

import { deleteAttachment } from "./deleteAttachment";

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
  entityCollectionPath: "deviceRequests",
  uploadedBy: "volunteer-1",
  description: "Fattura di acquisto",
  notes: "",
  fileName: "fattura.pdf",
  extension: "pdf",
  storagePath: "attachments/deviceRequest/request-42/att-1/fattura.pdf",
  size: 1024,
};

describe("deleteAttachment", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    fileDeleteMock.mockResolvedValue(undefined);
    usersStore = {
      "admin-1": { role: "admin" },
      "volunteer-1": { role: "volunteer" },
      "other-volunteer-1": { role: "volunteer" },
      "organizer-1": { role: "organizer" },
      "no-role-1": {},
    };
    getAttachmentByIdMock.mockResolvedValue(SAMPLE_ATTACHMENT);
    deleteAttachmentRecordMock.mockResolvedValue(undefined);
  });

  // Scenario 1: Admin elimina un allegato caricato da un altro utente
  it("lets an admin delete an attachment uploaded by someone else, removing file, document and index entry", async () => {
    const result = await deleteAttachment.run(buildRequest(baseData(), "admin-1"));

    expect(result).toEqual({ attachmentId: "att-1" });
    expect(bucketMock).toHaveBeenCalledWith("enableitalia-staging-attachments");
    expect(fileMock).toHaveBeenCalledWith("attachments/deviceRequest/request-42/att-1/fattura.pdf");
    expect(fileDeleteMock).toHaveBeenCalledTimes(1);
    expect(deleteAttachmentRecordMock).toHaveBeenCalledWith(
      expect.anything(),
      "deviceRequests",
      "att-1",
      "request-42"
    );
  });

  // Scenario 2: Volontario elimina un proprio allegato — stesso esito di successo dello Scenario 1
  it("lets a volunteer delete their own attachment with the same successful outcome as an admin", async () => {
    const result = await deleteAttachment.run(buildRequest(baseData(), "volunteer-1"));

    expect(result).toEqual({ attachmentId: "att-1" });
    expect(fileDeleteMock).toHaveBeenCalledTimes(1);
    expect(deleteAttachmentRecordMock).toHaveBeenCalledWith(
      expect.anything(),
      "deviceRequests",
      "att-1",
      "request-42"
    );
  });

  // Scenario 3: Volontario nega l'eliminazione di un allegato di altri
  it("denies a volunteer deleting another user's attachment, leaving file, document and index untouched", async () => {
    await expect(
      deleteAttachment.run(buildRequest(baseData(), "other-volunteer-1"))
    ).rejects.toMatchObject(
      new HttpsError("permission-denied", "Cannot delete another user's attachment")
    );

    expect(fileDeleteMock).not.toHaveBeenCalled();
    expect(deleteAttachmentRecordMock).not.toHaveBeenCalled();
  });

  // Scenario 4: Logging di ogni invocazione
  it("logs a success event when an admin deletes an attachment", async () => {
    await deleteAttachment.run(buildRequest(baseData(), "admin-1"));

    expect(logSecurityEventMock).toHaveBeenCalledTimes(1);
    expect(logSecurityEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "deleteAttachment",
        outcome: "success",
        actor: expect.objectContaining({ uid: "admin-1" }),
        context: expect.objectContaining({
          metadata: expect.objectContaining({ attachmentId: "att-1" }),
        }),
      })
    );
  });

  it("logs a success event when a volunteer deletes their own attachment", async () => {
    await deleteAttachment.run(buildRequest(baseData(), "volunteer-1"));

    expect(logSecurityEventMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: "deleteAttachment", outcome: "success" })
    );
  });

  it("logs a blocked event when a volunteer is denied deletion of another user's attachment", async () => {
    await expect(
      deleteAttachment.run(buildRequest(baseData(), "other-volunteer-1"))
    ).rejects.toThrow();

    expect(logSecurityEventMock).toHaveBeenCalledTimes(1);
    expect(logSecurityEventMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: "deleteAttachment", outcome: "blocked" })
    );
  });

  // Regressione: contratto di autenticazione/validazione argomenti di base
  it("denies an unauthenticated caller and deletes nothing", async () => {
    await expect(deleteAttachment.run(buildRequest(baseData(), null))).rejects.toMatchObject(
      new HttpsError("unauthenticated", "Authentication required")
    );

    expect(getAttachmentByIdMock).not.toHaveBeenCalled();
    expect(fileDeleteMock).not.toHaveBeenCalled();
    expect(deleteAttachmentRecordMock).not.toHaveBeenCalled();
  });

  it("logs a blocked event for an unauthenticated call", async () => {
    await expect(deleteAttachment.run(buildRequest(baseData(), null))).rejects.toThrow();

    expect(logSecurityEventMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: "deleteAttachment", outcome: "blocked" })
    );
  });

  it("throws invalid-argument when attachmentId is missing", async () => {
    await expect(
      deleteAttachment.run(buildRequest(baseData({ attachmentId: undefined }), "admin-1"))
    ).rejects.toMatchObject(
      new HttpsError("invalid-argument", "Missing or invalid parameter: attachmentId")
    );

    expect(getAttachmentByIdMock).not.toHaveBeenCalled();
  });

  // F-42 (panel review): entityCollectionPath non è più un parametro del
  // chiamante — un valore inviato comunque nel payload deve essere ignorato,
  // usando sempre il valore persistito sul record risolto. Prima del fix,
  // un valore sbagliato qui avrebbe reso l'eliminazione dell'entry indice un
  // no-op silenzioso.
  it("ignores any client-supplied entityCollectionPath and uses the value persisted on the resolved attachment", async () => {
    await deleteAttachment.run(
      buildRequest(baseData({ entityCollectionPath: "wrong-collection" }), "admin-1")
    );

    expect(deleteAttachmentRecordMock).toHaveBeenCalledWith(
      expect.anything(),
      "deviceRequests",
      "att-1",
      "request-42"
    );
  });

  // Regressione: attachmentId che non referenzia alcun allegato esistente
  it("throws not-found and deletes nothing when the attachment does not exist", async () => {
    getAttachmentByIdMock.mockResolvedValue(null);

    await expect(deleteAttachment.run(buildRequest(baseData(), "admin-1"))).rejects.toMatchObject(
      new HttpsError("not-found", "Attachment not found")
    );

    expect(fileDeleteMock).not.toHaveBeenCalled();
    expect(deleteAttachmentRecordMock).not.toHaveBeenCalled();
  });

  it("denies deletion to an authenticated volunteer's own attachment when uploaded by a different volunteer, without touching the bucket", async () => {
    await expect(
      deleteAttachment.run(buildRequest(baseData(), "other-volunteer-1"))
    ).rejects.toThrow();

    expect(fileMock).not.toHaveBeenCalled();
  });

  // Regressione: errori infrastrutturali imprevisti non devono sfuggire al logging di sicurezza
  it("logs a failure event and throws internal when the storage file delete throws unexpectedly", async () => {
    fileDeleteMock.mockRejectedValueOnce(new Error("bucket does not exist"));

    await expect(deleteAttachment.run(buildRequest(baseData(), "admin-1"))).rejects.toMatchObject(
      new HttpsError("internal", "Internal Server Error")
    );

    expect(deleteAttachmentRecordMock).not.toHaveBeenCalled();
    expect(logSecurityEventMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: "deleteAttachment", outcome: "failure" })
    );
  });

  it("logs a failure event and throws internal when deleting the Firestore records throws unexpectedly", async () => {
    deleteAttachmentRecordMock.mockRejectedValueOnce(new Error("network error"));

    await expect(deleteAttachment.run(buildRequest(baseData(), "admin-1"))).rejects.toMatchObject(
      new HttpsError("internal", "Internal Server Error")
    );

    expect(logSecurityEventMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: "deleteAttachment", outcome: "failure" })
    );
  });
});
