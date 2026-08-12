import { HttpsError } from "firebase-functions/v2/https";
import type { CallableRequest } from "firebase-functions/v2/https";

const SERVER_TIMESTAMP_SENTINEL = { __type: "serverTimestamp" };

/**
 * Store in-memory minimale che simula le collection Firestore coinvolte:
 * `users` (RBAC) e `deviceRequests` (documento principale, solo `update`).
 * Stesso pattern di `device-requests/createDeviceRequestChecklist.test.ts`.
 */
let usersStore: Record<string, Record<string, unknown> | undefined>;
let deviceRequestsStore: Record<string, Record<string, unknown> | undefined>;

const deviceRequestUpdateMock = jest.fn((id: string, updates: Record<string, unknown>) => {
  deviceRequestsStore[id] = { ...(deviceRequestsStore[id] ?? {}), ...updates };
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
      doc: jest.fn((id: string) => ({
        get: jest.fn(() =>
          Promise.resolve({
            exists: deviceRequestsStore[id] !== undefined,
            data: () => deviceRequestsStore[id],
          })
        ),
        update: jest.fn((updates: Record<string, unknown>) => deviceRequestUpdateMock(id, updates)),
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

const logSecurityEventMock = jest.fn().mockResolvedValue(undefined);

jest.mock("../security/securityLog", () => ({
  logSecurityEvent: (...args: unknown[]) => logSecurityEventMock(...args),
}));

import { setDeviceRequestConsent } from "./setDeviceRequestConsent";

function buildRequest(data: Record<string, unknown>, uid: string | null): CallableRequest {
  return {
    auth: uid ? ({ uid } as CallableRequest["auth"]) : undefined,
    data,
    rawRequest: { headers: {} } as CallableRequest["rawRequest"],
  } as CallableRequest;
}

describe("setDeviceRequestConsent", () => {
  beforeEach(() => {
    jest.clearAllMocks();

    usersStore = {
      "admin-1": { role: "admin" },
      "volunteer-1": { role: "volunteer" },
      "organizer-1": { role: "organizer" },
    };

    deviceRequestsStore = {
      "req-1": {
        status: "in produzione",
        assignedVolunteers: ["volunteer-1"],
      },
    };
  });

  // Scenario 1: Admin acquisisce lo scarico di responsabilità
  it("sets waiverAcquired=true, waiverAcquiredDate and waiverAcquiredBy, and logs a security event", async () => {
    const result = await setDeviceRequestConsent.run(
      buildRequest({ requestId: "req-1", consentType: "waiver" }, "admin-1")
    );

    expect(result).toEqual({ success: true });
    expect(deviceRequestsStore["req-1"]).toMatchObject({
      waiverAcquired: true,
      waiverAcquiredDate: SERVER_TIMESTAMP_SENTINEL,
      waiverAcquiredBy: "admin-1",
    });
    expect(deviceRequestsStore["req-1"]).not.toHaveProperty("photoReleaseAcquired");

    expect(logSecurityEventMock).toHaveBeenCalledTimes(1);
    const [event] = logSecurityEventMock.mock.calls[0];
    expect(event).toMatchObject({
      action: "set_waiver_acquired",
      outcome: "success",
      actor: { uid: "admin-1" },
      context: {
        function: "setDeviceRequestConsent",
        requestId: "req-1",
        metadata: { consentType: "waiver" },
      },
    });
  });

  // Scenario 2: Admin acquisisce la liberatoria foto
  it("sets photoReleaseAcquired=true, photoReleaseAcquiredDate and photoReleaseAcquiredBy, and logs a security event", async () => {
    const result = await setDeviceRequestConsent.run(
      buildRequest({ requestId: "req-1", consentType: "photoRelease" }, "admin-1")
    );

    expect(result).toEqual({ success: true });
    expect(deviceRequestsStore["req-1"]).toMatchObject({
      photoReleaseAcquired: true,
      photoReleaseAcquiredDate: SERVER_TIMESTAMP_SENTINEL,
      photoReleaseAcquiredBy: "admin-1",
    });
    expect(deviceRequestsStore["req-1"]).not.toHaveProperty("waiverAcquired");

    expect(logSecurityEventMock).toHaveBeenCalledTimes(1);
    const [event] = logSecurityEventMock.mock.calls[0];
    expect(event).toMatchObject({
      action: "set_photo_release_acquired",
      outcome: "success",
      actor: { uid: "admin-1" },
      context: {
        function: "setDeviceRequestConsent",
        requestId: "req-1",
        metadata: { consentType: "photoRelease" },
      },
    });
  });

  // Scenario 3: Volontario, anche se assegnato alla richiesta, viene rifiutato
  it("rejects an assigned volunteer with permission-denied and leaves the document untouched", async () => {
    await expect(
      setDeviceRequestConsent.run(buildRequest({ requestId: "req-1", consentType: "waiver" }, "volunteer-1"))
    ).rejects.toMatchObject(new HttpsError("permission-denied", "Only admin can acquire family waivers"));

    expect(deviceRequestUpdateMock).not.toHaveBeenCalled();
    expect(logSecurityEventMock).not.toHaveBeenCalled();
    expect(deviceRequestsStore["req-1"]).not.toHaveProperty("waiverAcquired");
  });

  // Regression: ruoli diversi da admin/volunteer restano rifiutati
  it("rejects a role other than admin", async () => {
    await expect(
      setDeviceRequestConsent.run(buildRequest({ requestId: "req-1", consentType: "photoRelease" }, "organizer-1"))
    ).rejects.toMatchObject(new HttpsError("permission-denied", "Only admin can acquire family waivers"));

    expect(deviceRequestUpdateMock).not.toHaveBeenCalled();
  });

  // Regression: utente autenticato senza documento users/{uid}
  it("rejects an authenticated user without a users/{uid} document", async () => {
    await expect(
      setDeviceRequestConsent.run(buildRequest({ requestId: "req-1", consentType: "waiver" }, "unknown-1"))
    ).rejects.toMatchObject(new HttpsError("permission-denied", "Only admin can acquire family waivers"));

    expect(deviceRequestUpdateMock).not.toHaveBeenCalled();
  });

  it("throws unauthenticated when there is no auth context, without querying Firestore", async () => {
    await expect(
      setDeviceRequestConsent.run(buildRequest({ requestId: "req-1", consentType: "waiver" }, null))
    ).rejects.toMatchObject(new HttpsError("unauthenticated", "User must be authenticated"));

    expect(collectionMock).not.toHaveBeenCalled();
  });

  it("throws invalid-argument when consentType is missing", async () => {
    await expect(
      setDeviceRequestConsent.run(buildRequest({ requestId: "req-1" }, "admin-1"))
    ).rejects.toMatchObject(new HttpsError("invalid-argument", "Missing or invalid parameters"));

    expect(deviceRequestUpdateMock).not.toHaveBeenCalled();
  });

  it("throws invalid-argument when consentType is not one of the known values", async () => {
    await expect(
      setDeviceRequestConsent.run(buildRequest({ requestId: "req-1", consentType: "consenso-inventato" }, "admin-1"))
    ).rejects.toMatchObject(new HttpsError("invalid-argument", "Missing or invalid parameters"));

    expect(deviceRequestUpdateMock).not.toHaveBeenCalled();
  });

  it("throws invalid-argument when requestId is missing", async () => {
    await expect(
      setDeviceRequestConsent.run(buildRequest({ consentType: "waiver" }, "admin-1"))
    ).rejects.toMatchObject(new HttpsError("invalid-argument", "Missing or invalid parameters"));

    expect(deviceRequestUpdateMock).not.toHaveBeenCalled();
  });

  it("throws not-found when the device request does not exist", async () => {
    await expect(
      setDeviceRequestConsent.run(buildRequest({ requestId: "missing-request", consentType: "waiver" }, "admin-1"))
    ).rejects.toMatchObject(new HttpsError("not-found", "Device request not found"));

    expect(deviceRequestUpdateMock).not.toHaveBeenCalled();
  });

  // Regressione: la scrittura di un tipo di consenso non deve intaccare i
  // campi già acquisiti dell'altro tipo sullo stesso documento.
  it("does not overwrite the other consent type's fields already set on the document", async () => {
    deviceRequestsStore["req-1"] = {
      ...deviceRequestsStore["req-1"],
      photoReleaseAcquired: true,
      photoReleaseAcquiredDate: "existing-date",
      photoReleaseAcquiredBy: "admin-0",
    };

    await setDeviceRequestConsent.run(buildRequest({ requestId: "req-1", consentType: "waiver" }, "admin-1"));

    expect(deviceRequestsStore["req-1"]).toMatchObject({
      waiverAcquired: true,
      waiverAcquiredBy: "admin-1",
      photoReleaseAcquired: true,
      photoReleaseAcquiredDate: "existing-date",
      photoReleaseAcquiredBy: "admin-0",
    });
  });
});
