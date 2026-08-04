import type { CallableRequest } from "firebase-functions/v2/https";

const sendChangeStatusNotificationsMock = jest.fn().mockResolvedValue(undefined);

jest.mock("./changeStatusNotifications", () => ({
  sendChangeStatusNotifications: (...args: unknown[]) => sendChangeStatusNotificationsMock(...args),
}));

jest.mock("../utils/consents", () => ({
  requireVolunteerConsents: jest.fn().mockResolvedValue(undefined),
}));

/**
 * Store in-memory minimale che simula `users` (RBAC) e `deviceRequests`
 * (stato corrente + `assignedVolunteers`). La transazione (`tx.update` /
 * `tx.set`) e il documento `publicDeviceRequests` sono applicati
 * direttamente sullo store per poter verificare lo stato post-transizione.
 */
let usersStore: Record<string, Record<string, unknown> | undefined>;
let deviceRequestsStore: Record<string, Record<string, unknown> | undefined>;
let publicDeviceRequestsStore: Record<string, Record<string, unknown> | undefined>;

const eventsAddMock = jest.fn();

function buildCollection(name: string) {
  if (name === "users") {
    return {
      doc: (uid: string) => ({
        get: () =>
          Promise.resolve({
            exists: usersStore[uid] !== undefined,
            data: () => usersStore[uid],
          }),
      }),
    };
  }

  if (name === "deviceRequests") {
    return {
      doc: (id: string) => ({
        get: () =>
          Promise.resolve({
            exists: deviceRequestsStore[id] !== undefined,
            data: () => deviceRequestsStore[id],
          }),
        collection: (sub: string) => {
          if (sub === "events") {
            return { doc: () => ({ id: "event-1" }) };
          }
          throw new Error(`Unexpected subcollection ${sub}`);
        },
      }),
    };
  }

  if (name === "publicDeviceRequests") {
    return {
      doc: (id: string) => ({
        get: () =>
          Promise.resolve({
            data: () => publicDeviceRequestsStore[id],
          }),
      }),
    };
  }

  throw new Error(`Unexpected collection ${name}`);
}

const collectionMock = jest.fn((name: string) => buildCollection(name));

const runTransactionMock = jest.fn(async (updateFn: (tx: unknown) => Promise<void>) => {
  const tx = {
    update: (ref: { __id: string }, data: Record<string, unknown>) => {
      deviceRequestsStore[ref.__id] = { ...deviceRequestsStore[ref.__id], ...data };
    },
    set: (ref: { __id: string; __collection: string }, data: Record<string, unknown>, opts?: { merge?: boolean }) => {
      if (ref.__collection === "events") {
        eventsAddMock(data);
        return;
      }
      if (ref.__collection === "publicDeviceRequests") {
        publicDeviceRequestsStore[ref.__id] = opts?.merge
          ? { ...publicDeviceRequestsStore[ref.__id], ...data }
          : data;
        return;
      }
      throw new Error(`Unexpected tx.set target ${ref.__collection}`);
    },
  };
  await updateFn(tx);
});

jest.mock("firebase-admin/firestore", () => ({
  getFirestore: jest.fn(() => ({
    collection: (name: string) => {
      const base = collectionMock(name);
      if (name === "deviceRequests") {
        return {
          doc: (id: string) => ({
            ...base.doc(id),
            __id: id,
            collection: (sub: string) => ({
              doc: () => ({ __id: id, __collection: sub }),
            }),
          }),
        };
      }
      if (name === "publicDeviceRequests") {
        return {
          doc: (id: string) => ({
            ...base.doc(id),
            __id: id,
            __collection: "publicDeviceRequests",
          }),
        };
      }
      return base;
    },
    runTransaction: runTransactionMock,
  })),
  FieldValue: { serverTimestamp: jest.fn(() => "SERVER_TIMESTAMP") },
}));

import { changeStatus } from "./changeStatus";

function buildRequest(data: Record<string, unknown>, uid: string | null = "admin-1"): CallableRequest {
  return {
    auth: uid ? ({ uid } as CallableRequest["auth"]) : undefined,
    data,
    rawRequest: { headers: {} } as CallableRequest["rawRequest"],
  } as CallableRequest;
}

describe("changeStatus", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    eventsAddMock.mockClear();

    usersStore = {
      "admin-1": { role: "admin" },
    };

    deviceRequestsStore = {
      "req-1": { status: "inviata", assignedVolunteers: [] },
    };

    publicDeviceRequestsStore = {};
  });

  // Scenario: nessuna notifica se il parametro notifica è omesso
  it("sends no email nor Telegram message when notifica is omitted", async () => {
    const result = await changeStatus.run(
      buildRequest({ requestId: "req-1", newStatus: "famiglia contattata" })
    );

    expect(result).toEqual({ success: true });
    expect(deviceRequestsStore["req-1"]?.status).toBe("famiglia contattata");
    expect(sendChangeStatusNotificationsMock).not.toHaveBeenCalled();
  });

  it("delegates to the extracted notifications module with the transitioned status when notifica is provided", async () => {
    await changeStatus.run(
      buildRequest({
        requestId: "req-1",
        newStatus: "famiglia contattata",
        note: "presa in carico",
        notifica: { admin: true, volunteers: true, telegram: true },
      })
    );

    expect(sendChangeStatusNotificationsMock).toHaveBeenCalledTimes(1);
    const [params] = sendChangeStatusNotificationsMock.mock.calls[0];
    expect(params).toMatchObject({
      requestId: "req-1",
      currentStatus: "inviata",
      newStatus: "famiglia contattata",
      note: "presa in carico",
      notifica: { admin: true, volunteers: true, telegram: true },
    });
  });
});
