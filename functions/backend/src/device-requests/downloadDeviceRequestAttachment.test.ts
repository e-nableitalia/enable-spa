import { HttpsError } from "firebase-functions/v2/https";
import type { CallableRequest } from "firebase-functions/v2/https";

const SIGNED_URL = "https://storage.googleapis.com/enableitalia-staging-attachments/signed-download-url";

let usersStore: Record<string, Record<string, unknown> | undefined>;
let deviceRequestsStore: Record<string, Record<string, unknown> | undefined>;
let attachmentsStore: Record<string, Record<string, unknown> | undefined>;

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

import { downloadDeviceRequestAttachment } from "./downloadDeviceRequestAttachment";

function buildRequest(data: Record<string, unknown>, uid: string | null = "admin-1"): CallableRequest {
  return {
    auth: uid ? ({ uid, token: { email: `${uid}@example.org` } } as CallableRequest["auth"]) : undefined,
    data,
    rawRequest: { headers: {} } as CallableRequest["rawRequest"],
  } as CallableRequest;
}

describe("downloadDeviceRequestAttachment", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getSignedUrlMock.mockResolvedValue([SIGNED_URL]);

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
        storagePath: "attachments/deviceRequest/req-1/att-1/fattura.pdf",
        fileName: "fattura.pdf",
      },
    };
  });

  it("lets an admin download an attachment of the request", async () => {
    const result = await downloadDeviceRequestAttachment.run(
      buildRequest({ requestId: "req-1", attachmentId: "att-1" }, "admin-1")
    );

    expect(result).toEqual({ attachmentId: "att-1", downloadUrl: SIGNED_URL, fileName: "fattura.pdf" });
  });

  it("lets a volunteer assigned to the request download the attachment", async () => {
    const result = await downloadDeviceRequestAttachment.run(
      buildRequest({ requestId: "req-1", attachmentId: "att-1" }, "volunteer-1")
    );

    expect(result).toMatchObject({ downloadUrl: SIGNED_URL });
  });

  it("denies download to a volunteer not assigned to the request", async () => {
    await expect(
      downloadDeviceRequestAttachment.run(
        buildRequest({ requestId: "req-1", attachmentId: "att-1" }, "volunteer-2")
      )
    ).rejects.toMatchObject(
      new HttpsError(
        "permission-denied",
        "Only admin or assigned volunteers can access attachments for this request"
      )
    );

    expect(getSignedUrlMock).not.toHaveBeenCalled();
  });

  // Impedisce che un volontario assegnato alla richiesta A usi il proprio
  // requestId per agire su un allegato in realtà appartenente alla B.
  it("throws not-found when the attachment does not belong to the given requestId, even for a volunteer assigned there", async () => {
    await expect(
      downloadDeviceRequestAttachment.run(
        buildRequest({ requestId: "req-2", attachmentId: "att-1" }, "volunteer-2")
      )
    ).rejects.toMatchObject(new HttpsError("not-found", "Attachment not linked to this device request"));

    expect(getSignedUrlMock).not.toHaveBeenCalled();
  });

  it("throws not-found when the attachment does not exist", async () => {
    await expect(
      downloadDeviceRequestAttachment.run(
        buildRequest({ requestId: "req-1", attachmentId: "missing-att" }, "admin-1")
      )
    ).rejects.toMatchObject(new HttpsError("not-found", "Attachment not found"));
  });

  it("throws unauthenticated when there is no auth context", async () => {
    await expect(
      downloadDeviceRequestAttachment.run(
        buildRequest({ requestId: "req-1", attachmentId: "att-1" }, null)
      )
    ).rejects.toMatchObject(new HttpsError("unauthenticated", "User must be authenticated"));
  });

  it("throws invalid-argument when requestId is missing", async () => {
    await expect(
      downloadDeviceRequestAttachment.run(buildRequest({ attachmentId: "att-1" }, "admin-1"))
    ).rejects.toMatchObject(new HttpsError("invalid-argument", "Missing parameter: requestId"));
  });

  it("throws invalid-argument when attachmentId is missing", async () => {
    await expect(
      downloadDeviceRequestAttachment.run(buildRequest({ requestId: "req-1" }, "admin-1"))
    ).rejects.toMatchObject(new HttpsError("invalid-argument", "Missing parameter: attachmentId"));
  });
});
