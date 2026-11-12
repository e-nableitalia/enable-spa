import { HttpsError } from "firebase-functions/v2/https";
import type { CallableRequest } from "firebase-functions/v2/https";

const SERVER_TIMESTAMP_SENTINEL = { __type: "serverTimestamp" };

let usersStore: Record<string, Record<string, unknown> | undefined>;
let deviceRequestsStore: Record<string, Record<string, unknown> | undefined>;
let attachmentsStore: Record<string, Record<string, unknown> | undefined>;

const updateMock = jest.fn((attachmentId: string, fields: Record<string, unknown>) => {
  attachmentsStore[attachmentId] = { ...attachmentsStore[attachmentId], ...fields };
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
      doc: jest.fn((requestId: string) => ({
        get: jest.fn(() =>
          Promise.resolve({
            exists: deviceRequestsStore[requestId] !== undefined,
            data: () => deviceRequestsStore[requestId],
          })
        ),
      })),
    };
  }

  if (name === "attachments") {
    return {
      doc: jest.fn((attachmentId: string) => ({
        get: jest.fn(() =>
          Promise.resolve({
            exists: attachmentsStore[attachmentId] !== undefined,
            data: () => attachmentsStore[attachmentId],
          })
        ),
        update: jest.fn((fields: Record<string, unknown>) => updateMock(attachmentId, fields)),
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
  FieldValue: {
    serverTimestamp: jest.fn(() => SERVER_TIMESTAMP_SENTINEL),
  },
}));

jest.mock("../security/securityLog", () => ({
  logSecurityEvent: jest.fn().mockResolvedValue(undefined),
}));

import { updateDeviceRequestAttachmentDescription } from "./updateDeviceRequestAttachmentDescription";

function buildRequest(data: Record<string, unknown>, uid: string | null = "admin-1"): CallableRequest {
  return {
    auth: uid ? ({ uid, token: { email: `${uid}@example.org` } } as CallableRequest["auth"]) : undefined,
    data,
    rawRequest: { headers: {} } as CallableRequest["rawRequest"],
  } as CallableRequest;
}

describe("updateDeviceRequestAttachmentDescription", () => {
  beforeEach(() => {
    jest.clearAllMocks();

    usersStore = {
      "admin-1": { role: "admin" },
      "volunteer-1": { role: "volunteer" },
      "volunteer-2": { role: "volunteer" },
    };
    deviceRequestsStore = {
      "req-1": { assignedVolunteers: ["volunteer-1"] },
      "req-2": { assignedVolunteers: ["volunteer-2"] },
    };
    attachmentsStore = {
      "att-1": {
        id: "att-1",
        entityType: "deviceRequest",
        entityId: "req-1",
        uploadedBy: "volunteer-1",
        description: "Vecchia descrizione",
        notes: "",
      },
    };
  });

  it("lets an admin update the description of an attachment uploaded by someone else", async () => {
    const result = await updateDeviceRequestAttachmentDescription.run(
      buildRequest({ requestId: "req-1", attachmentId: "att-1", description: "Nuova descrizione" }, "admin-1")
    );

    expect(result).toMatchObject({ attachmentId: "att-1", description: "Nuova descrizione" });
    expect(attachmentsStore["att-1"]).toMatchObject({ description: "Nuova descrizione" });
  });

  it("lets the uploading volunteer update their own attachment", async () => {
    const result = await updateDeviceRequestAttachmentDescription.run(
      buildRequest({ requestId: "req-1", attachmentId: "att-1", description: "Nuova descrizione" }, "volunteer-1")
    );

    expect(result).toMatchObject({ description: "Nuova descrizione" });
  });

  // La verifica di ownership per-allegato resta interamente a carico
  // della Cloud Function generica: un volontario diverso dal proprietario
  // è respinto anche se assegnato alla stessa richiesta.
  it("denies update to an assigned volunteer who is not the uploader (ownership enforced by the generic function)", async () => {
    attachmentsStore["att-1"] = { ...attachmentsStore["att-1"], uploadedBy: "some-other-volunteer" };
    deviceRequestsStore["req-1"] = { assignedVolunteers: ["volunteer-1", "some-other-volunteer"] };

    await expect(
      updateDeviceRequestAttachmentDescription.run(
        buildRequest({ requestId: "req-1", attachmentId: "att-1", description: "Nuova descrizione" }, "volunteer-1")
      )
    ).rejects.toMatchObject(new HttpsError("permission-denied", "Cannot modify another user's attachment"));

    expect(updateMock).not.toHaveBeenCalled();
  });

  it("denies access to a volunteer not assigned to the request at all", async () => {
    await expect(
      updateDeviceRequestAttachmentDescription.run(
        buildRequest({ requestId: "req-1", attachmentId: "att-1", description: "Nuova descrizione" }, "volunteer-2")
      )
    ).rejects.toMatchObject(
      new HttpsError(
        "permission-denied",
        "Only admin or assigned volunteers can access attachments for this request"
      )
    );

    expect(updateMock).not.toHaveBeenCalled();
  });

  it("throws not-found when the attachment does not belong to the given requestId", async () => {
    await expect(
      updateDeviceRequestAttachmentDescription.run(
        buildRequest({ requestId: "req-2", attachmentId: "att-1", description: "Nuova descrizione" }, "volunteer-2")
      )
    ).rejects.toMatchObject(new HttpsError("not-found", "Attachment not linked to this device request"));

    expect(updateMock).not.toHaveBeenCalled();
  });

  it("throws invalid-argument when requestId is missing", async () => {
    await expect(
      updateDeviceRequestAttachmentDescription.run(
        buildRequest({ attachmentId: "att-1", description: "Nuova descrizione" }, "admin-1")
      )
    ).rejects.toMatchObject(new HttpsError("invalid-argument", "Missing parameter: requestId"));
  });

  it("throws invalid-argument when attachmentId is missing", async () => {
    await expect(
      updateDeviceRequestAttachmentDescription.run(
        buildRequest({ requestId: "req-1", description: "Nuova descrizione" }, "admin-1")
      )
    ).rejects.toMatchObject(new HttpsError("invalid-argument", "Missing parameter: attachmentId"));
  });
});
