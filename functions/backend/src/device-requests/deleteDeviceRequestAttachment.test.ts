import { HttpsError } from "firebase-functions/v2/https";
import type { CallableRequest } from "firebase-functions/v2/https";

let usersStore: Record<string, Record<string, unknown> | undefined>;
let deviceRequestsStore: Record<string, Record<string, unknown> | undefined>;
let attachmentsStore: Record<string, Record<string, unknown> | undefined>;
let indexStore: Record<string, Record<string, Record<string, unknown>>>;

const batchDeleteMock = jest.fn(
  (ref: { __kind: string; id: string; entityId?: string }) => {
    if (ref.__kind === "attachment") {
      delete attachmentsStore[ref.id];
    } else {
      delete indexStore[ref.entityId as string]?.[ref.id];
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
      doc: jest.fn((attachmentId: string) => ({
        __kind: "attachment" as const,
        id: attachmentId,
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
    batch: jest.fn(() => ({ delete: batchDeleteMock, commit: batchCommitMock })),
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

jest.mock("../security/securityLog", () => ({
  logSecurityEvent: jest.fn().mockResolvedValue(undefined),
}));

import { deleteDeviceRequestAttachment } from "./deleteDeviceRequestAttachment";

function buildRequest(data: Record<string, unknown>, uid: string | null = "admin-1"): CallableRequest {
  return {
    auth: uid ? ({ uid, token: { email: `${uid}@example.org` } } as CallableRequest["auth"]) : undefined,
    data,
    rawRequest: { headers: {} } as CallableRequest["rawRequest"],
  } as CallableRequest;
}

describe("deleteDeviceRequestAttachment", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    fileDeleteMock.mockResolvedValue(undefined);

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
        entityCollectionPath: "deviceRequests",
        uploadedBy: "volunteer-1",
        storagePath: "attachments/deviceRequest/req-1/att-1/fattura.pdf",
      },
    };
    indexStore = { "req-1": { "att-1": { attachmentId: "att-1" } } };
  });

  it("lets an admin delete an attachment uploaded by someone else, removing file, document and index entry", async () => {
    const result = await deleteDeviceRequestAttachment.run(
      buildRequest({ requestId: "req-1", attachmentId: "att-1" }, "admin-1")
    );

    expect(result).toEqual({ attachmentId: "att-1" });
    expect(fileDeleteMock).toHaveBeenCalledWith({ ignoreNotFound: true });
    expect(attachmentsStore["att-1"]).toBeUndefined();
    expect(indexStore["req-1"]?.["att-1"]).toBeUndefined();
  });

  it("lets the uploading volunteer delete their own attachment", async () => {
    const result = await deleteDeviceRequestAttachment.run(
      buildRequest({ requestId: "req-1", attachmentId: "att-1" }, "volunteer-1")
    );

    expect(result).toEqual({ attachmentId: "att-1" });
  });

  it("denies deletion to an assigned volunteer who is not the uploader (ownership enforced by the generic function)", async () => {
    attachmentsStore["att-1"] = { ...attachmentsStore["att-1"], uploadedBy: "some-other-volunteer" };
    deviceRequestsStore["req-1"] = { assignedVolunteers: ["volunteer-1", "some-other-volunteer"] };

    await expect(
      deleteDeviceRequestAttachment.run(buildRequest({ requestId: "req-1", attachmentId: "att-1" }, "volunteer-1"))
    ).rejects.toMatchObject(new HttpsError("permission-denied", "Cannot delete another user's attachment"));

    expect(fileDeleteMock).not.toHaveBeenCalled();
  });

  it("denies access to a volunteer not assigned to the request at all", async () => {
    await expect(
      deleteDeviceRequestAttachment.run(buildRequest({ requestId: "req-1", attachmentId: "att-1" }, "volunteer-2"))
    ).rejects.toMatchObject(
      new HttpsError(
        "permission-denied",
        "Only admin or assigned volunteers can access attachments for this request"
      )
    );

    expect(fileDeleteMock).not.toHaveBeenCalled();
  });

  it("throws not-found when the attachment does not belong to the given requestId", async () => {
    await expect(
      deleteDeviceRequestAttachment.run(buildRequest({ requestId: "req-2", attachmentId: "att-1" }, "volunteer-2"))
    ).rejects.toMatchObject(new HttpsError("not-found", "Attachment not linked to this device request"));

    expect(fileDeleteMock).not.toHaveBeenCalled();
  });

  it("throws invalid-argument when requestId is missing", async () => {
    await expect(
      deleteDeviceRequestAttachment.run(buildRequest({ attachmentId: "att-1" }, "admin-1"))
    ).rejects.toMatchObject(new HttpsError("invalid-argument", "Missing parameter: requestId"));
  });

  it("throws invalid-argument when attachmentId is missing", async () => {
    await expect(
      deleteDeviceRequestAttachment.run(buildRequest({ requestId: "req-1" }, "admin-1"))
    ).rejects.toMatchObject(new HttpsError("invalid-argument", "Missing parameter: attachmentId"));
  });
});
