import { HttpsError } from "firebase-functions/v2/https";
import type { CallableRequest } from "firebase-functions/v2/https";

const SERVER_TIMESTAMP_SENTINEL = { __type: "serverTimestamp" };
const DELETE_SENTINEL = { __type: "deleteField" };

let usersStore: Record<string, Record<string, unknown> | undefined>;
let deviceRequestsStore: Record<string, Record<string, unknown> | undefined>;
const updateMock = jest.fn();
const setMock = jest.fn();
const runTransactionMock = jest.fn(async (fn: (tx: { update: typeof updateMock; set: typeof setMock }) => Promise<void>) => {
  await fn({ update: updateMock, set: setMock });
});

jest.mock("firebase-admin/firestore", () => ({
  getFirestore: jest.fn(() => ({
    collection: (name: string) => {
      if (name === "users") {
        return {
          doc: (uid: string) => ({
            get: async () => ({
              exists: usersStore[uid] !== undefined,
              data: () => usersStore[uid],
            }),
          }),
        };
      }
      if (name === "deviceRequests") {
        return {
          doc: (requestId: string) => ({
            get: async () => ({
              exists: deviceRequestsStore[requestId] !== undefined,
              data: () => deviceRequestsStore[requestId],
            }),
            collection: () => ({
              doc: () => ({}),
            }),
          }),
        };
      }
      throw new Error(`Unexpected collection ${name}`);
    },
    runTransaction: (fn: (tx: { update: typeof updateMock; set: typeof setMock }) => Promise<void>) =>
      runTransactionMock(fn),
  })),
  FieldValue: {
    serverTimestamp: jest.fn(() => SERVER_TIMESTAMP_SENTINEL),
    delete: jest.fn(() => DELETE_SENTINEL),
  },
}));

const listAttachmentsForEntityMock = jest.fn().mockResolvedValue([]);
const deleteAttachmentRecordMock = jest.fn().mockResolvedValue(undefined);
const fileDeleteMock = jest.fn().mockResolvedValue(undefined);

jest.mock("firebase-admin/storage", () => ({
  getStorage: jest.fn(() => ({
    bucket: () => ({
      file: () => ({
        delete: (...args: unknown[]) => fileDeleteMock(...args),
      }),
    }),
  })),
}));

jest.mock("firebase-admin/app", () => ({
  getApp: jest.fn(() => ({ options: { projectId: "test-project" } })),
}));

jest.mock("../utils/invoke", () => ({
  getInvokeId: () => "invoke-1",
}));

jest.mock("../attachments/attachmentModel", () => ({
  listAttachmentsForEntity: (...args: unknown[]) => listAttachmentsForEntityMock(...args),
  deleteAttachmentRecord: (...args: unknown[]) => deleteAttachmentRecordMock(...args),
  normalizeAttachmentRetention: (v: unknown) => (v === "transient" ? "transient" : "persistent"),
}));

import { archiveDeviceRequest, restoreDeviceRequest } from "./archiveDeviceRequest";

function buildRequest(data: Record<string, unknown>, uid: string | null): CallableRequest {
  return {
    data,
    auth: uid ? ({ uid, token: {} } as CallableRequest["auth"]) : undefined,
    rawRequest: {} as CallableRequest["rawRequest"],
    acceptsStreaming: false,
  } as CallableRequest;
}

describe("archiveDeviceRequest / restoreDeviceRequest", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    usersStore = { "admin-1": { role: "admin" }, "volunteer-1": { role: "volunteer" } };
    deviceRequestsStore = {
      "req-1": { status: "completata", archived: false },
    };
  });

  it("archives a completed request", async () => {
    const result = await archiveDeviceRequest.run(
      buildRequest({ requestId: "req-1", purgeTransientAttachments: false }, "admin-1")
    );
    expect(result).toMatchObject({ requestId: "req-1", archived: true, purgedTransientCount: 0 });
    expect(updateMock).toHaveBeenCalled();
    expect(setMock).toHaveBeenCalled();
  });

  it("rejects archive when status is not terminal", async () => {
    deviceRequestsStore["req-1"] = { status: "in produzione", archived: false };
    await expect(
      archiveDeviceRequest.run(buildRequest({ requestId: "req-1" }, "admin-1"))
    ).rejects.toMatchObject({ code: "failed-precondition" });
  });

  it("rejects archive for non-admin", async () => {
    await expect(
      archiveDeviceRequest.run(buildRequest({ requestId: "req-1" }, "volunteer-1"))
    ).rejects.toBeInstanceOf(HttpsError);
  });

  it("restores an archived request", async () => {
    deviceRequestsStore["req-1"] = { status: "completata", archived: true };
    const result = await restoreDeviceRequest.run(buildRequest({ requestId: "req-1" }, "admin-1"));
    expect(result).toMatchObject({ requestId: "req-1", archived: false });
  });

  it("purges only transient attachments from GCS and Firestore when requested", async () => {
    listAttachmentsForEntityMock.mockResolvedValueOnce([
      {
        id: "att-transient",
        retention: "transient",
        storagePath: "attachments/deviceRequest/req-1/att-transient/foto.jpg",
        entityCollectionPath: "deviceRequests",
        entityId: "req-1",
      },
      {
        id: "att-persistent",
        retention: "persistent",
        storagePath: "attachments/deviceRequest/req-1/att-persistent/waiver.pdf",
        entityCollectionPath: "deviceRequests",
        entityId: "req-1",
      },
      {
        id: "att-legacy",
        retention: undefined,
        storagePath: "attachments/deviceRequest/req-1/att-legacy/old.pdf",
        entityCollectionPath: "deviceRequests",
        entityId: "req-1",
      },
    ]);

    const result = await archiveDeviceRequest.run(
      buildRequest({ requestId: "req-1", purgeTransientAttachments: true }, "admin-1")
    );

    expect(result).toMatchObject({
      requestId: "req-1",
      archived: true,
      purgedTransientCount: 1,
      purgeErrors: [],
    });
    expect(fileDeleteMock).toHaveBeenCalledTimes(1);
    expect(fileDeleteMock).toHaveBeenCalledWith({ ignoreNotFound: true });
    expect(deleteAttachmentRecordMock).toHaveBeenCalledTimes(1);
    expect(deleteAttachmentRecordMock).toHaveBeenCalledWith(
      expect.anything(),
      "deviceRequests",
      "att-transient",
      "req-1"
    );
  });

  it("does not purge attachments when purgeTransientAttachments is omitted", async () => {
    listAttachmentsForEntityMock.mockResolvedValueOnce([
      {
        id: "att-transient",
        retention: "transient",
        storagePath: "attachments/deviceRequest/req-1/att-transient/foto.jpg",
        entityCollectionPath: "deviceRequests",
        entityId: "req-1",
      },
    ]);

    const result = await archiveDeviceRequest.run(buildRequest({ requestId: "req-1" }, "admin-1"));

    expect(result).toMatchObject({ purgedTransientCount: 0 });
    expect(listAttachmentsForEntityMock).not.toHaveBeenCalled();
    expect(fileDeleteMock).not.toHaveBeenCalled();
    expect(deleteAttachmentRecordMock).not.toHaveBeenCalled();
  });
});
