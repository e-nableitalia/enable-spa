import { HttpsError } from "firebase-functions/v2/https";
import type { CallableRequest } from "firebase-functions/v2/https";

let usersStore: Record<string, Record<string, unknown> | undefined>;

const getAttachmentByIdMock = jest.fn();
const updateAttachmentFieldsMock = jest.fn().mockResolvedValue(undefined);
jest.mock("./attachmentModel", () => ({
  getAttachmentById: (...args: unknown[]) => getAttachmentByIdMock(...args),
  updateAttachmentFields: (...args: unknown[]) => updateAttachmentFieldsMock(...args),
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

const logSecurityEventMock = jest.fn().mockResolvedValue(undefined);
jest.mock("../security/securityLog", () => ({
  logSecurityEvent: (...args: unknown[]) => logSecurityEventMock(...args),
}));

import { updateAttachmentDescription } from "./updateAttachmentDescription";

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
    description: "Descrizione aggiornata",
    ...overrides,
  };
}

const SAMPLE_ATTACHMENT = {
  id: "att-1",
  entityType: "deviceRequest",
  entityId: "request-42",
  uploadedBy: "volunteer-1",
  description: "Fattura di acquisto",
  notes: "Nota originale",
  fileName: "fattura.pdf",
  extension: "pdf",
  storagePath: "attachments/deviceRequest/request-42/att-1/fattura.pdf",
  size: 1024,
};

describe("updateAttachmentDescription", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    usersStore = {
      "admin-1": { role: "admin" },
      "volunteer-1": { role: "volunteer" },
      "other-volunteer-1": { role: "volunteer" },
      "organizer-1": { role: "organizer" },
      "no-role-1": {},
    };
    getAttachmentByIdMock.mockResolvedValue(SAMPLE_ATTACHMENT);
    updateAttachmentFieldsMock.mockResolvedValue(undefined);
  });

  // Scenario 1: Admin modifica la descrizione di un allegato caricato da un altro utente
  it("lets an admin update the description of an attachment uploaded by someone else", async () => {
    const result = await updateAttachmentDescription.run(
      buildRequest(baseData(), "admin-1")
    );

    expect(result).toEqual({
      attachmentId: "att-1",
      description: "Descrizione aggiornata",
      notes: "Nota originale",
    });
    expect(updateAttachmentFieldsMock).toHaveBeenCalledWith(expect.anything(), "att-1", {
      description: "Descrizione aggiornata",
      notes: undefined,
    });
  });

  // Scenario 2: Volontario modifica la descrizione di un proprio allegato
  it("lets a volunteer update the description of their own attachment", async () => {
    const result = await updateAttachmentDescription.run(
      buildRequest(baseData({ notes: "Nota aggiornata" }), "volunteer-1")
    );

    expect(result).toEqual({
      attachmentId: "att-1",
      description: "Descrizione aggiornata",
      notes: "Nota aggiornata",
    });
    expect(updateAttachmentFieldsMock).toHaveBeenCalledWith(expect.anything(), "att-1", {
      description: "Descrizione aggiornata",
      notes: "Nota aggiornata",
    });
  });

  // Scenario 3: Volontario nega la modifica su un allegato di altri
  it("denies a volunteer modifying another user's attachment and persists no change", async () => {
    await expect(
      updateAttachmentDescription.run(buildRequest(baseData(), "other-volunteer-1"))
    ).rejects.toMatchObject(
      new HttpsError("permission-denied", "Cannot modify another user's attachment")
    );

    expect(updateAttachmentFieldsMock).not.toHaveBeenCalled();
  });

  it("logs a blocked event when a volunteer is denied on another user's attachment", async () => {
    await expect(
      updateAttachmentDescription.run(buildRequest(baseData(), "other-volunteer-1"))
    ).rejects.toThrow();

    expect(logSecurityEventMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: "updateAttachmentDescription", outcome: "blocked" })
    );
  });

  // Scenario 4: Descrizione vuota rifiutata (caso admin, diritto di modifica già verificato)
  it("rejects an empty description from an admin and persists no change", async () => {
    await expect(
      updateAttachmentDescription.run(buildRequest(baseData({ description: "" }), "admin-1"))
    ).rejects.toMatchObject(new HttpsError("invalid-argument", "description is required"));

    expect(updateAttachmentFieldsMock).not.toHaveBeenCalled();
  });

  it("rejects a blank (whitespace-only) description and persists no change", async () => {
    await expect(
      updateAttachmentDescription.run(buildRequest(baseData({ description: "   " }), "admin-1"))
    ).rejects.toMatchObject(new HttpsError("invalid-argument", "description is required"));

    expect(updateAttachmentFieldsMock).not.toHaveBeenCalled();
  });

  it("rejects a missing description from the attachment's own volunteer owner and persists no change", async () => {
    await expect(
      updateAttachmentDescription.run(
        buildRequest(baseData({ description: undefined }), "volunteer-1")
      )
    ).rejects.toMatchObject(new HttpsError("invalid-argument", "description is required"));

    expect(updateAttachmentFieldsMock).not.toHaveBeenCalled();
  });

  it("logs a blocked event when the description is empty", async () => {
    await expect(
      updateAttachmentDescription.run(buildRequest(baseData({ description: "" }), "admin-1"))
    ).rejects.toThrow();

    expect(logSecurityEventMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: "updateAttachmentDescription", outcome: "blocked" })
    );
  });

  // Regressione: contratto di autenticazione/validazione argomenti di base
  it("denies an unauthenticated caller and persists no change", async () => {
    await expect(
      updateAttachmentDescription.run(buildRequest(baseData(), null))
    ).rejects.toMatchObject(new HttpsError("unauthenticated", "Authentication required"));

    expect(getAttachmentByIdMock).not.toHaveBeenCalled();
    expect(updateAttachmentFieldsMock).not.toHaveBeenCalled();
  });

  it("throws invalid-argument when attachmentId is missing", async () => {
    await expect(
      updateAttachmentDescription.run(
        buildRequest(baseData({ attachmentId: undefined }), "admin-1")
      )
    ).rejects.toMatchObject(
      new HttpsError("invalid-argument", "Missing or invalid parameter: attachmentId")
    );

    expect(getAttachmentByIdMock).not.toHaveBeenCalled();
  });

  it("throws invalid-argument when notes is not a string", async () => {
    await expect(
      updateAttachmentDescription.run(buildRequest(baseData({ notes: 42 }), "admin-1"))
    ).rejects.toMatchObject(new HttpsError("invalid-argument", "notes must be a string"));

    expect(getAttachmentByIdMock).not.toHaveBeenCalled();
  });

  it("throws not-found and persists no change when the attachment does not exist", async () => {
    getAttachmentByIdMock.mockResolvedValue(null);

    await expect(
      updateAttachmentDescription.run(buildRequest(baseData(), "admin-1"))
    ).rejects.toMatchObject(new HttpsError("not-found", "Attachment not found"));

    expect(updateAttachmentFieldsMock).not.toHaveBeenCalled();
  });

  it("logs a success event when the update is persisted", async () => {
    await updateAttachmentDescription.run(buildRequest(baseData(), "admin-1"));

    expect(logSecurityEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "updateAttachmentDescription",
        outcome: "success",
        actor: expect.objectContaining({ uid: "admin-1" }),
        context: expect.objectContaining({
          metadata: expect.objectContaining({ attachmentId: "att-1" }),
        }),
      })
    );
  });

  it("logs a failure event and throws internal when the Firestore update throws unexpectedly", async () => {
    updateAttachmentFieldsMock.mockRejectedValueOnce(new Error("network error"));

    await expect(
      updateAttachmentDescription.run(buildRequest(baseData(), "admin-1"))
    ).rejects.toMatchObject(new HttpsError("internal", "Internal Server Error"));

    expect(logSecurityEventMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: "updateAttachmentDescription", outcome: "failure" })
    );
  });
});
