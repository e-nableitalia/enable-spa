import { HttpsError } from "firebase-functions/v2/https";
import type { CallableRequest } from "firebase-functions/v2/https";

/**
 * Store in-memory minimale che simula le collection Firestore coinvolte:
 * `users` (RBAC + query sugli admin) e `deviceRequests` (documento
 * principale, per `assignedVolunteers`). Stesso pattern di
 * `createDeviceRequestChecklist.test.ts`.
 */
let usersStore: Record<string, Record<string, unknown> | undefined>;
let deviceRequestsStore: Record<string, Record<string, unknown> | undefined>;

const usersWhereMock = jest.fn((field: string, _op: string, value: unknown) => ({
  get: jest.fn(() => {
    const matches = Object.entries(usersStore).filter(
      ([, data]) => data !== undefined && (data as Record<string, unknown>)[field] === value
    );
    return Promise.resolve({
      docs: matches.map(([id]) => ({ id })),
    });
  }),
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
      where: usersWhereMock,
    };
  }

  if (name === "deviceRequests") {
    return {
      doc: jest.fn((id: string) => ({
        get: jest.fn(() =>
          Promise.resolve({
            exists: deviceRequestsStore[id] !== undefined,
            data: () => deviceRequestsStore[id],
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

import { listAssignableChecklistUsers } from "./listAssignableChecklistUsers";

function buildRequest(data: Record<string, unknown>, uid: string | null = "admin-1"): CallableRequest {
  return {
    auth: uid ? ({ uid } as CallableRequest["auth"]) : undefined,
    data,
    rawRequest: { headers: {} } as CallableRequest["rawRequest"],
  } as CallableRequest;
}

describe("listAssignableChecklistUsers", () => {
  beforeEach(() => {
    jest.clearAllMocks();

    usersStore = {
      "admin-1": { role: "admin" },
      "admin-2": { role: "admin" },
      "volunteer-1": { role: "volunteer" },
      "volunteer-2": { role: "volunteer" },
    };

    deviceRequestsStore = {
      "req-1": { assignedVolunteers: ["volunteer-1"] },
    };
  });

  // Regressione F-27: prima di questa funzione, un volontario non poteva
  // vedere alcun admin diverso da se stesso tra le opzioni (le regole
  // Firestore non permettono a un client di leggere il documento users/{uid}
  // di un altro utente).
  it("returns assignedVolunteers plus every admin uid, not just the caller", async () => {
    const result = await listAssignableChecklistUsers.run(buildRequest({ requestId: "req-1" }, "volunteer-1"));

    expect((result as { uids: string[] }).uids.sort()).toEqual(["admin-1", "admin-2", "volunteer-1"].sort());
  });

  it("allows an admin caller, even if not assigned to the request", async () => {
    const result = await listAssignableChecklistUsers.run(buildRequest({ requestId: "req-1" }, "admin-1"));

    expect((result as { uids: string[] }).uids.sort()).toEqual(["admin-1", "admin-2", "volunteer-1"].sort());
  });

  it("deduplicates an admin who is also listed in assignedVolunteers", async () => {
    deviceRequestsStore["req-1"] = { assignedVolunteers: ["volunteer-1", "admin-1"] };

    const result = await listAssignableChecklistUsers.run(buildRequest({ requestId: "req-1" }, "admin-1"));

    expect((result as { uids: string[] }).uids.filter((u) => u === "admin-1")).toHaveLength(1);
  });

  it("denies a volunteer not assigned to the request", async () => {
    await expect(
      listAssignableChecklistUsers.run(buildRequest({ requestId: "req-1" }, "volunteer-2"))
    ).rejects.toMatchObject(
      new HttpsError(
        "permission-denied",
        "Only admin or assigned volunteers can list assignable users for this request"
      )
    );

    expect(usersWhereMock).not.toHaveBeenCalled();
  });

  it("throws unauthenticated when there is no auth context", async () => {
    await expect(
      listAssignableChecklistUsers.run(buildRequest({ requestId: "req-1" }, null))
    ).rejects.toMatchObject(new HttpsError("unauthenticated", "User must be authenticated"));

    expect(collectionMock).not.toHaveBeenCalled();
  });

  it("throws invalid-argument when requestId is missing", async () => {
    await expect(listAssignableChecklistUsers.run(buildRequest({}, "admin-1"))).rejects.toMatchObject(
      new HttpsError("invalid-argument", "Missing parameter: requestId")
    );
  });

  it("throws not-found when the device request does not exist", async () => {
    await expect(
      listAssignableChecklistUsers.run(buildRequest({ requestId: "missing-request" }, "admin-1"))
    ).rejects.toMatchObject(new HttpsError("not-found", "Device request not found"));
  });
});
