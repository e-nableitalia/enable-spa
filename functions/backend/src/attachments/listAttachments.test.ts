import { HttpsError } from "firebase-functions/v2/https";
import type { CallableRequest } from "firebase-functions/v2/https";

let usersStore: Record<string, Record<string, unknown> | undefined>;

const listAttachmentsForEntityMock = jest.fn();
jest.mock("./attachmentModel", () => ({
  listAttachmentsForEntity: (...args: unknown[]) => listAttachmentsForEntityMock(...args),
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

import { listAttachments } from "./listAttachments";

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
    ...overrides,
  };
}

const SAMPLE_ATTACHMENTS = [
  { id: "att-1", description: "Fattura di acquisto", fileName: "fattura.pdf" },
  { id: "att-2", description: "Foto imballo", fileName: "foto.jpg" },
];

describe("listAttachments", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    usersStore = {
      "admin-1": { role: "admin" },
      "volunteer-1": { role: "volunteer" },
      "organizer-1": { role: "organizer" },
      "no-role-1": {},
    };
    listAttachmentsForEntityMock.mockResolvedValue(SAMPLE_ATTACHMENTS);
  });

  // Scenario 1: Admin elenca gli allegati di un'entità
  it("lets an admin list the full set of attachments with complete metadata", async () => {
    const result = await listAttachments.run(buildRequest(baseData(), "admin-1"));

    expect(result).toEqual({ attachments: SAMPLE_ATTACHMENTS });
    expect(listAttachmentsForEntityMock).toHaveBeenCalledWith(
      expect.anything(),
      "deviceRequests",
      "request-42"
    );
  });

  // Scenario 2: Volontario elenca gli allegati della stessa entità — stesso elenco, nessun filtro di ownership
  it("lets a volunteer list the same full set of attachments with no ownership filter applied", async () => {
    const result = await listAttachments.run(buildRequest(baseData(), "volunteer-1"));

    expect(result).toEqual({ attachments: SAMPLE_ATTACHMENTS });
  });

  // Scenario 3: Utente non-staff nega l'accesso all'elenco
  it("denies access to an organizer (non-staff role) and returns no data", async () => {
    await expect(listAttachments.run(buildRequest(baseData(), "organizer-1"))).rejects.toMatchObject(
      new HttpsError("permission-denied", "Only staff (admin or volunteer) can list attachments")
    );

    expect(listAttachmentsForEntityMock).not.toHaveBeenCalled();
  });

  it("denies access to an authenticated user with no staff role at all", async () => {
    await expect(listAttachments.run(buildRequest(baseData(), "no-role-1"))).rejects.toMatchObject(
      new HttpsError("permission-denied", "Only staff (admin or volunteer) can list attachments")
    );

    expect(listAttachmentsForEntityMock).not.toHaveBeenCalled();
  });

  it("denies access to an unauthenticated caller", async () => {
    await expect(listAttachments.run(buildRequest(baseData(), null))).rejects.toMatchObject(
      new HttpsError("unauthenticated", "Authentication required")
    );

    expect(listAttachmentsForEntityMock).not.toHaveBeenCalled();
  });

  // Scenario 4: Entità senza allegati -> elenco vuoto, senza errore
  it("returns an empty list without error when the entity has no attachments", async () => {
    listAttachmentsForEntityMock.mockResolvedValue([]);

    const result = await listAttachments.run(buildRequest(baseData(), "admin-1"));

    expect(result).toEqual({ attachments: [] });
  });

  // Logging: ogni invocazione registra l'esito
  it("logs a success event with the resolved attachment count", async () => {
    await listAttachments.run(buildRequest(baseData(), "admin-1"));

    expect(logSecurityEventMock).toHaveBeenCalledTimes(1);
    expect(logSecurityEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "listAttachments",
        outcome: "success",
        actor: expect.objectContaining({ uid: "admin-1" }),
        context: expect.objectContaining({
          metadata: expect.objectContaining({ count: 2 }),
        }),
      })
    );
  });

  it("logs a blocked event when a non-staff user is denied", async () => {
    await expect(listAttachments.run(buildRequest(baseData(), "organizer-1"))).rejects.toThrow();

    expect(logSecurityEventMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: "listAttachments", outcome: "blocked" })
    );
  });

  it("logs a blocked event for an unauthenticated call", async () => {
    await expect(listAttachments.run(buildRequest(baseData(), null))).rejects.toThrow();

    expect(logSecurityEventMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: "listAttachments", outcome: "blocked" })
    );
  });

  // Regressione: contratto di validazione argomenti di base
  it("throws invalid-argument when entityType is missing", async () => {
    await expect(
      listAttachments.run(buildRequest(baseData({ entityType: undefined }), "admin-1"))
    ).rejects.toMatchObject(new HttpsError("invalid-argument", "Missing or invalid parameter: entityType"));
  });

  it("throws invalid-argument when entityId is missing", async () => {
    await expect(
      listAttachments.run(buildRequest(baseData({ entityId: undefined }), "admin-1"))
    ).rejects.toMatchObject(new HttpsError("invalid-argument", "Missing or invalid parameter: entityId"));
  });

  it("throws invalid-argument when entityCollectionPath is missing", async () => {
    await expect(
      listAttachments.run(buildRequest(baseData({ entityCollectionPath: undefined }), "admin-1"))
    ).rejects.toMatchObject(
      new HttpsError("invalid-argument", "Missing or invalid parameter: entityCollectionPath")
    );
  });

  // Regressione: errori infrastrutturali imprevisti non devono sfuggire al logging di sicurezza
  it("logs a failure event and throws internal when listAttachmentsForEntity throws unexpectedly", async () => {
    listAttachmentsForEntityMock.mockRejectedValueOnce(new Error("firestore unavailable"));

    await expect(listAttachments.run(buildRequest(baseData(), "admin-1"))).rejects.toMatchObject(
      new HttpsError("internal", "Internal Server Error")
    );

    expect(logSecurityEventMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: "listAttachments", outcome: "failure" })
    );
  });
});
