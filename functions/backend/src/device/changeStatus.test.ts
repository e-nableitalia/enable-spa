import { HttpsError } from "firebase-functions/v2/https";
import type { CallableRequest } from "firebase-functions/v2/https";

const SERVER_TIMESTAMP_SENTINEL = { __type: "serverTimestamp" };
const CONSENT_VERSION = "2026-03";
const ACCEPTED_CONSENTS = {
  privacy: { accepted: true, version: CONSENT_VERSION },
  codeOfConduct: { accepted: true, version: CONSENT_VERSION },
};

let usersStore: Record<string, Record<string, unknown> | undefined>;
let deviceRequestsStore: Record<string, Record<string, unknown> | undefined>;

const txUpdateMock = jest.fn();
const txSetMock = jest.fn();

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
      doc: jest.fn((id: string) => ({
        get: jest.fn(() =>
          Promise.resolve({
            exists: deviceRequestsStore[id] !== undefined,
            data: () => deviceRequestsStore[id],
          })
        ),
        collection: jest.fn((sub: string) => {
          if (sub === "events") {
            return { doc: jest.fn(() => ({ id: `event-${id}` })) };
          }
          throw new Error(`Unexpected subcollection ${sub}`);
        }),
      })),
    };
  }

  if (name === "publicDeviceRequests") {
    return {
      doc: jest.fn((id: string) => ({ id: `public-${id}` })),
    };
  }

  throw new Error(`Unexpected collection ${name}`);
}

const collectionMock = jest.fn((name: string) => buildCollection(name));

jest.mock("firebase-admin/firestore", () => ({
  getFirestore: jest.fn(() => ({
    collection: (name: string) => collectionMock(name),
    runTransaction: jest.fn(async (fn: (tx: unknown) => Promise<void>) => {
      const tx = { update: txUpdateMock, set: txSetMock };
      await fn(tx);
    }),
  })),
  FieldValue: {
    serverTimestamp: jest.fn(() => SERVER_TIMESTAMP_SENTINEL),
  },
}));

const sendChangeStatusNotificationsMock = jest.fn().mockResolvedValue(undefined);

jest.mock("./changeStatusNotifications", () => ({
  sendChangeStatusNotifications: (...args: unknown[]) => sendChangeStatusNotificationsMock(...args),
}));

import { changeStatus } from "./changeStatus";

function buildRequest(data: Record<string, unknown>, uid: string | null): CallableRequest {
  return {
    auth: uid ? ({ uid, token: { email: "user@example.com" } } as CallableRequest["auth"]) : undefined,
    data,
    rawRequest: { headers: {} } as CallableRequest["rawRequest"],
  } as CallableRequest;
}

describe("changeStatus", () => {
  beforeEach(() => {
    jest.clearAllMocks();

    usersStore = {
      "admin-1": { role: "admin", consents: ACCEPTED_CONSENTS },
      "volunteer-1": { role: "volunteer", consents: ACCEPTED_CONSENTS },
      "volunteer-2": { role: "volunteer", consents: ACCEPTED_CONSENTS },
      "organizer-1": { role: "organizer", consents: ACCEPTED_CONSENTS },
    };

    deviceRequestsStore = {
      "req-1": {
        status: "scelta device e dimensionamento",
        assignedVolunteers: ["volunteer-1"],
      },
    };
  });

  // Scenario 1 (EA-103): admin può eseguire qualsiasi transizione
  it("allows admin to perform any transition without additional RBAC checks", async () => {
    const result = await changeStatus.run(
      buildRequest({ requestId: "req-1", newStatus: "spedita" }, "admin-1")
    );

    expect(result).toEqual({ success: true });
    expect(txUpdateMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ status: "spedita" })
    );
  });

  // Scenario 2 (EA-103): volontario assegnato può eseguire una delle 5 transizioni consentite
  it("allows an assigned volunteer to perform one of the 5 allowed transitions", async () => {
    const result = await changeStatus.run(
      buildRequest({ requestId: "req-1", newStatus: "personalizzazione" }, "volunteer-1")
    );

    expect(result).toEqual({ success: true });
    expect(txUpdateMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ status: "personalizzazione" })
    );
  });

  // Scenario 3 (EA-103): volontario tenta una transizione non consentita
  it("rejects an assigned volunteer attempting a transition not among the 5 allowed", async () => {
    await expect(
      changeStatus.run(buildRequest({ requestId: "req-1", newStatus: "spedita" }, "volunteer-1"))
    ).rejects.toMatchObject(new HttpsError("permission-denied", "Invalid status transition"));

    expect(txUpdateMock).not.toHaveBeenCalled();
  });

  // Scenario 4 (EA-103): volontario non assegnato viene rifiutato indipendentemente dalla transizione
  it("rejects a volunteer not assigned to the request regardless of the target status", async () => {
    await expect(
      changeStatus.run(buildRequest({ requestId: "req-1", newStatus: "personalizzazione" }, "volunteer-2"))
    ).rejects.toMatchObject(new HttpsError("permission-denied", "Not assigned volunteer"));

    expect(txUpdateMock).not.toHaveBeenCalled();
  });

  // Regression (EA-103): ruolo diverso da admin/volunteer resta rifiutato come da comportamento pre-refactoring
  it("rejects a role other than admin or volunteer", async () => {
    await expect(
      changeStatus.run(buildRequest({ requestId: "req-1", newStatus: "personalizzazione" }, "organizer-1"))
    ).rejects.toMatchObject(new HttpsError("permission-denied", "Invalid role"));

    expect(txUpdateMock).not.toHaveBeenCalled();
  });

  // Scenario 1 (EA-104): nessuna notifica se il parametro notifica è omesso
  it("sends no notification when notifica is omitted", async () => {
    const result = await changeStatus.run(
      buildRequest({ requestId: "req-1", newStatus: "personalizzazione" }, "admin-1")
    );

    expect(result).toEqual({ success: true });
    expect(sendChangeStatusNotificationsMock).not.toHaveBeenCalled();
  });

  // Scenario 2 (EA-104): notifica presente -> delega al modulo estratto con lo stato transizionato
  it("delegates to the extracted notifications module with the transitioned status when notifica is provided", async () => {
    await changeStatus.run(
      buildRequest(
        {
          requestId: "req-1",
          newStatus: "personalizzazione",
          note: "presa in carico",
          notifica: { admin: true, volunteers: true, telegram: true },
        },
        "admin-1"
      )
    );

    expect(sendChangeStatusNotificationsMock).toHaveBeenCalledTimes(1);
    const [params] = sendChangeStatusNotificationsMock.mock.calls[0];
    expect(params).toMatchObject({
      requestId: "req-1",
      currentStatus: "scelta device e dimensionamento",
      newStatus: "personalizzazione",
      note: "presa in carico",
      notifica: { admin: true, volunteers: true, telegram: true },
    });
  });
});
