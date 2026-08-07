import { HttpsError } from "firebase-functions/v2/https";
import type { CallableRequest } from "firebase-functions/v2/https";

const SERVER_TIMESTAMP_SENTINEL = { __type: "serverTimestamp" };
const CONSENT_VERSION = "2026-03";
const ACCEPTED_CONSENTS = {
  privacy: { accepted: true, version: CONSENT_VERSION },
  codeOfConduct: { accepted: true, version: CONSENT_VERSION },
};

/**
 * Store in-memory minimale che simula le collection Firestore coinvolte:
 * `users` (RBAC + consensi volontario) e `deviceRequests` (documento
 * principale + sottocollezione `events`).
 */
let usersStore: Record<string, Record<string, unknown> | undefined>;
let deviceRequestsStore: Record<string, Record<string, unknown> | undefined>;
let eventsStore: Record<string, Array<Record<string, unknown>>>;

// Consente ai test di far fallire la write dell'evento per verificare che
// la transazione non produca scritture parziali.
let forceEventWriteFailure = false;

type WriteRef =
  | { __kind: "deviceRequest"; __id: string }
  | { __kind: "event"; __id: string };

interface QueuedWrite {
  ref: WriteRef;
  data: Record<string, unknown>;
  options?: { merge?: boolean };
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

// Simula l'atomicita' di Firestore: le write vengono accodate durante
// l'esecuzione della callback e "committate" sugli store solo se la
// callback arriva in fondo senza eccezioni. Se una write fallisce, nessuno
// degli store viene toccato.
const runTransactionMock = jest.fn(
  async (updateFn: (tx: { update: jest.Mock; set: jest.Mock }) => Promise<void> | void) => {
    const writes: QueuedWrite[] = [];
    const tx = {
      update: jest.fn((ref: WriteRef, data: Record<string, unknown>) => {
        writes.push({ ref, data });
      }),
      set: jest.fn((ref: WriteRef, data: Record<string, unknown>) => {
        if (forceEventWriteFailure && ref.__kind === "event") {
          throw new Error("Simulated Firestore write failure");
        }
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

jest.mock("firebase-admin/firestore", () => ({
  getFirestore: jest.fn(() => ({
    collection: (name: string) => collectionMock(name),
    runTransaction: (updateFn: (tx: unknown) => Promise<void>) => runTransactionMock(updateFn),
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
    forceEventWriteFailure = false;

    usersStore = {
      "admin-1": { role: "admin", consents: ACCEPTED_CONSENTS },
      "volunteer-1": { role: "volunteer", consents: ACCEPTED_CONSENTS },
      "volunteer-2": { role: "volunteer", consents: ACCEPTED_CONSENTS },
      "organizer-1": { role: "organizer", consents: ACCEPTED_CONSENTS },
    };

    deviceRequestsStore = {
      "req-1": {
        status: "in produzione",
        assignedVolunteers: ["volunteer-1"],
      },
    };

    eventsStore = {};
  });

  // Scenario 1 (EA-103): admin può eseguire qualsiasi transizione
  it("allows admin to perform any transition without additional RBAC checks", async () => {
    const result = await changeStatus.run(
      buildRequest({ requestId: "req-1", newStatus: "spedita" }, "admin-1")
    );

    expect(result).toEqual({ success: true });
    expect(deviceRequestsStore["req-1"]).toMatchObject({ status: "spedita" });
  });

  // Scenario 2 (EA-103, ridotto a 2 coppie da EA-148): volontario assegnato
  // può eseguire una delle 2 transizioni consentite
  it("allows an assigned volunteer to perform one of the 2 allowed transitions", async () => {
    const result = await changeStatus.run(
      buildRequest({ requestId: "req-1", newStatus: "pronta per spedizione" }, "volunteer-1")
    );

    expect(result).toEqual({ success: true });
    expect(deviceRequestsStore["req-1"]).toMatchObject({ status: "pronta per spedizione" });
  });

  // Scenario 3 (EA-103, ridotto a 2 coppie da EA-148): volontario tenta una transizione non consentita
  it("rejects an assigned volunteer attempting a transition not among the 2 allowed", async () => {
    await expect(
      changeStatus.run(buildRequest({ requestId: "req-1", newStatus: "spedita" }, "volunteer-1"))
    ).rejects.toMatchObject(new HttpsError("permission-denied", "Invalid status transition"));

    expect(runTransactionMock).not.toHaveBeenCalled();
  });

  // Scenario 4 (EA-103): volontario non assegnato viene rifiutato indipendentemente dalla transizione
  it("rejects a volunteer not assigned to the request regardless of the target status", async () => {
    await expect(
      changeStatus.run(buildRequest({ requestId: "req-1", newStatus: "pronta per spedizione" }, "volunteer-2"))
    ).rejects.toMatchObject(new HttpsError("permission-denied", "Not assigned volunteer"));

    expect(runTransactionMock).not.toHaveBeenCalled();
  });

  // Regression (EA-103): ruolo diverso da admin/volunteer resta rifiutato come da comportamento pre-refactoring
  it("rejects a role other than admin or volunteer", async () => {
    await expect(
      changeStatus.run(buildRequest({ requestId: "req-1", newStatus: "pronta per spedizione" }, "organizer-1"))
    ).rejects.toMatchObject(new HttpsError("permission-denied", "Invalid role"));

    expect(runTransactionMock).not.toHaveBeenCalled();
  });

  // Scenario 1 (EA-104): nessuna notifica se il parametro notifica è omesso
  it("sends no notification when notifica is omitted", async () => {
    const result = await changeStatus.run(
      buildRequest({ requestId: "req-1", newStatus: "pronta per spedizione" }, "admin-1")
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
          newStatus: "pronta per spedizione",
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
      currentStatus: "in produzione",
      newStatus: "pronta per spedizione",
      note: "presa in carico",
      notifica: { admin: true, volunteers: true, telegram: true },
    });
  });

  // Scenario 1 (EA-149): changeStatus non scrive più publicStatus, né su
  // deviceRequests né su publicDeviceRequests (quest'ultima non viene più
  // nemmeno toccata: buildCollection lancia se qualcosa la richiede ancora).
  it("Scenario 1: updates status/updatedAt and writes the event, without ever touching publicStatus or publicDeviceRequests", async () => {
    await changeStatus.run(
      buildRequest({ requestId: "req-1", newStatus: "pronta per spedizione", note: "avanti" }, "admin-1")
    );

    expect(runTransactionMock).toHaveBeenCalledTimes(1);

    expect(deviceRequestsStore["req-1"]).toEqual({
      status: "pronta per spedizione",
      assignedVolunteers: ["volunteer-1"],
      updatedAt: SERVER_TIMESTAMP_SENTINEL,
    });
    expect(deviceRequestsStore["req-1"]).not.toHaveProperty("publicStatus");

    expect(eventsStore["req-1"]).toHaveLength(1);
    expect(eventsStore["req-1"][0]).toEqual({
      type: "status_change",
      fromStatus: "in produzione",
      toStatus: "pronta per spedizione",
      timestamp: SERVER_TIMESTAMP_SENTINEL,
      createdBy: "admin-1",
      note: "avanti",
    });
  });

  // Scenario "fallimento della transazione non produce scritture parziali"
  // (non regressione, EA-106): se una delle write fallisce, nessuno dei due
  // documenti viene modificato.
  it("leaves both documents untouched when one of the transaction writes fails", async () => {
    forceEventWriteFailure = true;

    await expect(
      changeStatus.run(buildRequest({ requestId: "req-1", newStatus: "pronta per spedizione" }, "admin-1"))
    ).rejects.toThrow("Simulated Firestore write failure");

    expect(deviceRequestsStore["req-1"]).toEqual({
      status: "in produzione",
      assignedVolunteers: ["volunteer-1"],
    });
    expect(eventsStore["req-1"]).toBeUndefined();
  });
});

describe("changeStatus - EA-148 (riduzione dominio status a 11 valori)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    forceEventWriteFailure = false;

    usersStore = {
      "admin-1": { role: "admin", consents: ACCEPTED_CONSENTS },
      "volunteer-1": { role: "volunteer", consents: ACCEPTED_CONSENTS },
    };

    deviceRequestsStore = {
      "req-triage": {
        status: "validata",
        assignedVolunteers: [],
      },
      "req-waiting": {
        status: "attesa volontario",
        assignedVolunteers: [],
      },
      "req-cancel": {
        status: "da gestire",
        assignedVolunteers: [],
      },
      "req-prod": {
        status: "in produzione",
        assignedVolunteers: ["volunteer-1"],
      },
      "req-manage": {
        status: "da gestire",
        assignedVolunteers: ["volunteer-1"],
      },
    };

    eventsStore = {};
  });

  // Scenario 1: Admin porta una richiesta di triage a "da gestire"
  it("moves a request from 'validata' to 'da gestire' and records a status_change event", async () => {
    const result = await changeStatus.run(
      buildRequest({ requestId: "req-triage", newStatus: "da gestire" }, "admin-1")
    );

    expect(result).toEqual({ success: true });
    expect(deviceRequestsStore["req-triage"]).toMatchObject({ status: "da gestire" });
    expect(eventsStore["req-triage"]).toHaveLength(1);
    expect(eventsStore["req-triage"][0]).toMatchObject({
      type: "status_change",
      fromStatus: "validata",
      toStatus: "da gestire",
    });
  });

  // Scenario 2: Admin porta una richiesta a "in produzione"
  it("moves a request from 'attesa volontario' to 'in produzione'", async () => {
    const result = await changeStatus.run(
      buildRequest({ requestId: "req-waiting", newStatus: "in produzione" }, "admin-1")
    );

    expect(result).toEqual({ success: true });
    expect(deviceRequestsStore["req-waiting"]).toMatchObject({ status: "in produzione" });
  });

  // Scenario 3: Admin annulla una richiesta con motivo specifico salvato come nota sull'evento
  it("cancels a non-terminal request to 'annullata', storing the specific reason as an event note rather than a separate status value", async () => {
    const result = await changeStatus.run(
      buildRequest(
        { requestId: "req-cancel", newStatus: "annullata", note: "famiglia irraggiungibile da 3 mesi" },
        "admin-1"
      )
    );

    expect(result).toEqual({ success: true });
    expect(deviceRequestsStore["req-cancel"]).toMatchObject({ status: "annullata" });
    expect(eventsStore["req-cancel"]).toHaveLength(1);
    expect(eventsStore["req-cancel"][0]).toMatchObject({
      type: "status_change",
      toStatus: "annullata",
      note: "famiglia irraggiungibile da 3 mesi",
    });
  });

  // Scenario 4: Volontario avanza tra le due coppie consentite
  it("allows an assigned volunteer to move 'in produzione' -> 'pronta per spedizione'", async () => {
    const result = await changeStatus.run(
      buildRequest({ requestId: "req-prod", newStatus: "pronta per spedizione" }, "volunteer-1")
    );

    expect(result).toEqual({ success: true });
    expect(deviceRequestsStore["req-prod"]).toMatchObject({ status: "pronta per spedizione" });
  });

  // Scenario 5: Volontario tenta una transizione non più consentita
  it("rejects an assigned volunteer moving 'da gestire' -> 'in produzione' with permission-denied and leaves status unchanged", async () => {
    await expect(
      changeStatus.run(buildRequest({ requestId: "req-manage", newStatus: "in produzione" }, "volunteer-1"))
    ).rejects.toMatchObject(new HttpsError("permission-denied", "Invalid status transition"));

    expect(runTransactionMock).not.toHaveBeenCalled();
    expect(deviceRequestsStore["req-manage"]).toMatchObject({ status: "da gestire" });
  });
});
