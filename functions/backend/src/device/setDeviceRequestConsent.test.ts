import { HttpsError } from "firebase-functions/v2/https";
import type { CallableRequest } from "firebase-functions/v2/https";

const SERVER_TIMESTAMP_SENTINEL = { __type: "serverTimestamp" };

/**
 * Store in-memory minimale che simula le collection Firestore coinvolte:
 * `users` (RBAC), `deviceRequests` (documento principale) e la
 * sottocollezione `events` (event sourcing, `dc-request-event`) — stesso
 * pattern di `device/changeStatus.test.ts`: le write sono accodate dentro
 * la callback della transazione e "committate" sugli store solo al termine,
 * per simulare l'atomicità reale di `db.runTransaction`.
 */
let usersStore: Record<string, Record<string, unknown> | undefined>;
let deviceRequestsStore: Record<string, Record<string, unknown> | undefined>;
let eventsStore: Record<string, Array<Record<string, unknown>>>;

type WriteRef =
  | { __kind: "deviceRequest"; __id: string }
  | { __kind: "event"; __id: string };

interface QueuedWrite {
  ref: WriteRef;
  data: Record<string, unknown>;
}

function buildDeviceRequestRef(id: string) {
  return {
    __kind: "deviceRequest" as const,
    __id: id,
    get: jest.fn(() =>
      Promise.resolve({
        exists: deviceRequestsStore[id] !== undefined,
        data: () => deviceRequestsStore[id],
      })
    ),
    collection: jest.fn((sub: string) => {
      if (sub !== "events") {
        throw new Error(`Unexpected subcollection ${sub}`);
      }
      return {
        doc: jest.fn(() => ({ __kind: "event" as const, __id: id })),
      };
    }),
  };
}

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
    return { doc: jest.fn((id: string) => buildDeviceRequestRef(id)) };
  }

  throw new Error(`Unexpected collection ${name}`);
}

const collectionMock = jest.fn((name: string) => buildCollection(name));

const runTransactionMock = jest.fn(
  async (updateFn: (tx: { update: jest.Mock; set: jest.Mock }) => Promise<void> | void) => {
    const writes: QueuedWrite[] = [];
    const tx = {
      update: jest.fn((ref: WriteRef, data: Record<string, unknown>) => {
        writes.push({ ref, data });
      }),
      set: jest.fn((ref: WriteRef, data: Record<string, unknown>) => {
        writes.push({ ref, data });
      }),
    };

    await updateFn(tx);

    for (const w of writes) {
      if (w.ref.__kind === "deviceRequest") {
        deviceRequestsStore[w.ref.__id] = { ...(deviceRequestsStore[w.ref.__id] ?? {}), ...w.data };
      } else if (w.ref.__kind === "event") {
        eventsStore[w.ref.__id] = eventsStore[w.ref.__id] ?? [];
        eventsStore[w.ref.__id].push(w.data);
      }
    }
  }
);

// Alias retro-compatibile con le asserzioni esistenti che si aspettavano un
// `update` diretto sul documento: la transazione produce lo stesso effetto
// visibile su `deviceRequestsStore`, quindi le assert su quello store restano
// valide invariate; solo le assert dirette su "e' stato chiamato update()"
// vanno riferite a `runTransactionMock`.
const deviceRequestUpdateMock = runTransactionMock;

jest.mock("firebase-admin/firestore", () => ({
  getFirestore: jest.fn(() => ({
    collection: (name: string) => collectionMock(name),
    runTransaction: (updateFn: (tx: unknown) => Promise<void>) => runTransactionMock(updateFn),
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
    eventsStore = {};
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

  // Regressione (panel review EA-158): senza un evento in
  // deviceRequests/{id}/events, l'acquisizione della liberatoria resta
  // invisibile nella RequestTimeline consultata dall'admin — stesso pattern
  // di event-sourcing (dc-request-event) usato da ogni altra scrittura sulla
  // deviceRequest (changeStatus, setAssignedVolunteers).
  it("records an event in deviceRequests/{id}/events with fromStatus===toStatus (update, not a status transition)", async () => {
    await setDeviceRequestConsent.run(
      buildRequest({ requestId: "req-1", consentType: "waiver" }, "admin-1")
    );

    expect(eventsStore["req-1"]).toHaveLength(1);
    expect(eventsStore["req-1"][0]).toMatchObject({
      type: "set_waiver_consent",
      fromStatus: "in produzione",
      toStatus: "in produzione",
      createdBy: "admin-1",
      note: "Scarico di responsabilità acquisito",
      timestamp: SERVER_TIMESTAMP_SENTINEL,
    });
  });

  it("records a distinct event type and note for the photo-release consent", async () => {
    await setDeviceRequestConsent.run(
      buildRequest({ requestId: "req-1", consentType: "photoRelease" }, "admin-1")
    );

    expect(eventsStore["req-1"]).toHaveLength(1);
    expect(eventsStore["req-1"][0]).toMatchObject({
      type: "set_photo_release_consent",
      note: "Liberatoria foto acquisita",
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
