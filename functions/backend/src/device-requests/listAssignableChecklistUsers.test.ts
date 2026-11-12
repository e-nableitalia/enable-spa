import { HttpsError } from "firebase-functions/v2/https";
import type { CallableRequest } from "firebase-functions/v2/https";

/**
 * Store in-memory minimale che simula le collection Firestore coinvolte:
 * `users` (RBAC + query sugli admin), `users/{uid}/private/profile` (label)
 * e `deviceRequests` (documento principale, per `assignedVolunteers`).
 * Stesso pattern di `createDeviceRequestChecklist.test.ts`.
 */
let usersStore: Record<string, Record<string, unknown> | undefined>;
let profilesStore: Record<string, Record<string, unknown> | undefined>;
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
        collection: jest.fn((sub: string) => {
          if (sub !== "private") throw new Error(`Unexpected subcollection ${sub}`);
          return {
            doc: jest.fn((docId: string) => ({
              get: jest.fn(() => {
                if (docId !== "profile") {
                  return Promise.resolve({ exists: false, data: () => undefined });
                }
                const profile = profilesStore[uid];
                return Promise.resolve({
                  exists: profile !== undefined,
                  data: () => profile,
                });
              }),
            })),
          };
        }),
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

function userIds(result: unknown): string[] {
  return (result as { users: { id: string; label: string }[] }).users.map((u) => u.id).sort();
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

    profilesStore = {
      "admin-1": { firstName: "Ada", lastName: "Admin" },
      "admin-2": { firstName: "Luca", lastName: "Verdi" },
      "volunteer-1": { firstName: "Anna", lastName: "Bianchi" },
    };

    deviceRequestsStore = {
      "req-1": { assignedVolunteers: ["volunteer-1"] },
    };
  });

  // Regressione F-27: prima di questa funzione, un volontario non poteva
  // vedere alcun admin diverso da se stesso tra le opzioni (le regole
  // Firestore non permettono a un client di leggere il documento users/{uid}
  // di un altro utente).
  it("returns assignedVolunteers plus every admin, with server-resolved labels", async () => {
    const result = await listAssignableChecklistUsers.run(buildRequest({ requestId: "req-1" }, "volunteer-1"));

    expect(userIds(result)).toEqual(["admin-1", "admin-2", "volunteer-1"].sort());
    expect((result as { users: { id: string; label: string }[] }).users).toEqual(
      expect.arrayContaining([
        { id: "volunteer-1", label: "Anna Bianchi" },
        { id: "admin-2", label: "Luca Verdi" },
      ])
    );
  });

  it("allows an admin caller, even if not assigned to the request", async () => {
    const result = await listAssignableChecklistUsers.run(buildRequest({ requestId: "req-1" }, "admin-1"));

    expect(userIds(result)).toEqual(["admin-1", "admin-2", "volunteer-1"].sort());
  });

  it("deduplicates an admin who is also listed in assignedVolunteers", async () => {
    deviceRequestsStore["req-1"] = { assignedVolunteers: ["volunteer-1", "admin-1"] };

    const result = await listAssignableChecklistUsers.run(buildRequest({ requestId: "req-1" }, "admin-1"));

    expect(userIds(result).filter((u) => u === "admin-1")).toHaveLength(1);
  });

  it("falls back to the legacy assignedVolunteer scalar when assignedVolunteers is absent", async () => {
    deviceRequestsStore["req-1"] = { assignedVolunteer: "volunteer-1" };

    const result = await listAssignableChecklistUsers.run(buildRequest({ requestId: "req-1" }, "volunteer-1"));

    expect(userIds(result)).toContain("volunteer-1");
    expect((result as { users: { id: string; label: string }[] }).users).toEqual(
      expect.arrayContaining([{ id: "volunteer-1", label: "Anna Bianchi" }])
    );
  });

  it("falls back to uid when the private profile is missing", async () => {
    delete profilesStore["volunteer-1"];

    const result = await listAssignableChecklistUsers.run(buildRequest({ requestId: "req-1" }, "admin-1"));
    const volunteer = (result as { users: { id: string; label: string }[] }).users.find(
      (u) => u.id === "volunteer-1"
    );

    expect(volunteer).toEqual({ id: "volunteer-1", label: "volunteer-1" });
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
