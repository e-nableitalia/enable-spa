import { HttpsError } from "firebase-functions/v2/https";
import type { CallableRequest } from "firebase-functions/v2/https";

let usersStore: Record<string, Record<string, unknown> | undefined>;
let deviceRequestsStore: Record<string, Record<string, unknown> | undefined>;
/** Documenti in `attachments/{attachmentId}`. */
let attachmentsStore: Record<string, Record<string, unknown>>;
/** Entry indice in `deviceRequests/{requestId}/attachments/{attachmentId}`, in ordine di inserimento. */
let indexStore: Record<string, string[]>;

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
            orderBy: jest.fn(() => ({
              get: jest.fn(() => {
                const ids = indexStore[requestId] ?? [];
                return Promise.resolve({
                  empty: ids.length === 0,
                  docs: ids.map((id) => ({ id })),
                });
              }),
            })),
          };
        }),
      })),
    };
  }

  if (name === "attachments") {
    return {
      doc: jest.fn((attachmentId: string) => ({ id: attachmentId, __collection: "attachments" })),
    };
  }

  throw new Error(`Unexpected collection ${name}`);
}

const collectionMock = jest.fn((name: string) => buildCollection(name));
const getAllMock = jest.fn((...refs: { id: string }[]) =>
  Promise.resolve(
    refs.map((ref) => ({
      exists: attachmentsStore[ref.id] !== undefined,
      data: () => attachmentsStore[ref.id],
    }))
  )
);

jest.mock("firebase-admin/firestore", () => ({
  getFirestore: jest.fn(() => ({
    collection: (name: string) => collectionMock(name),
    getAll: (...refs: { id: string }[]) => getAllMock(...refs),
  })),
}));

jest.mock("../security/securityLog", () => ({
  logSecurityEvent: jest.fn().mockResolvedValue(undefined),
}));

import { listDeviceRequestAttachments } from "./listDeviceRequestAttachments";

function buildRequest(data: Record<string, unknown>, uid: string | null = "admin-1"): CallableRequest {
  return {
    auth: uid ? ({ uid, token: { email: `${uid}@example.org` } } as CallableRequest["auth"]) : undefined,
    data,
    rawRequest: { headers: {} } as CallableRequest["rawRequest"],
  } as CallableRequest;
}

describe("listDeviceRequestAttachments", () => {
  beforeEach(() => {
    jest.clearAllMocks();

    usersStore = {
      "admin-1": { role: "admin" },
      "volunteer-1": { role: "volunteer" },
      "volunteer-2": { role: "volunteer" },
    };
    deviceRequestsStore = {
      "req-1": { assignedVolunteers: ["volunteer-1"] },
    };
    attachmentsStore = {
      "att-1": {
        id: "att-1",
        entityType: "deviceRequest",
        entityId: "req-1",
        category: "documenti",
        fileName: "fattura.pdf",
      },
    };
    indexStore = { "req-1": ["att-1"] };
  });

  it("lets an admin list attachments of the request", async () => {
    const result = await listDeviceRequestAttachments.run(buildRequest({ requestId: "req-1" }, "admin-1"));

    expect(result).toEqual({ attachments: [attachmentsStore["att-1"]] });
  });

  it("lets a volunteer assigned to the request list attachments, same result as admin", async () => {
    const result = await listDeviceRequestAttachments.run(buildRequest({ requestId: "req-1" }, "volunteer-1"));

    expect(result).toEqual({ attachments: [attachmentsStore["att-1"]] });
  });

  it("denies listing to a volunteer not assigned to the request", async () => {
    await expect(
      listDeviceRequestAttachments.run(buildRequest({ requestId: "req-1" }, "volunteer-2"))
    ).rejects.toMatchObject(
      new HttpsError(
        "permission-denied",
        "Only admin or assigned volunteers can access attachments for this request"
      )
    );
  });

  it("returns an empty list for a request with no attachments, no error", async () => {
    indexStore["req-1"] = [];

    const result = await listDeviceRequestAttachments.run(buildRequest({ requestId: "req-1" }, "admin-1"));

    expect(result).toEqual({ attachments: [] });
    expect(getAllMock).not.toHaveBeenCalled();
  });

  it("throws unauthenticated when there is no auth context", async () => {
    await expect(
      listDeviceRequestAttachments.run(buildRequest({ requestId: "req-1" }, null))
    ).rejects.toMatchObject(new HttpsError("unauthenticated", "User must be authenticated"));
  });

  it("throws invalid-argument when requestId is missing", async () => {
    await expect(
      listDeviceRequestAttachments.run(buildRequest({}, "admin-1"))
    ).rejects.toMatchObject(new HttpsError("invalid-argument", "Missing parameter: requestId"));
  });
});
