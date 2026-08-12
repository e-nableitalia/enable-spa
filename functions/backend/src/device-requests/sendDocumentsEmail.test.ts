import { HttpsError } from "firebase-functions/v2/https";
import type { CallableRequest } from "firebase-functions/v2/https";

const SERVER_TIMESTAMP_SENTINEL = { __type: "serverTimestamp" };

let usersStore: Record<string, Record<string, unknown> | undefined>;
let deviceRequestsStore: Record<string, Record<string, unknown> | undefined>;
let privateDataStore: Record<string, Record<string, unknown> | undefined>;
let mailStore: Record<string, Record<string, unknown>>;

let generatedMailIdCounter = 0;

function buildCollection(name: string) {
  if (name === "users") {
    return {
      doc: jest.fn((uid: string) => ({
        get: jest.fn(() =>
          Promise.resolve({ exists: usersStore[uid] !== undefined, data: () => usersStore[uid] })
        ),
      })),
    };
  }

  if (name === "deviceRequests") {
    return {
      doc: jest.fn((id: string) => ({
        id,
        get: jest.fn(() =>
          Promise.resolve({
            exists: deviceRequestsStore[id] !== undefined,
            data: () => deviceRequestsStore[id],
          })
        ),
        collection: jest.fn((subName: string) => {
          if (subName !== "private") throw new Error(`Unexpected subcollection ${subName}`);
          return {
            doc: jest.fn((docId: string) => {
              if (docId !== "data") throw new Error(`Unexpected private doc ${docId}`);
              const key = id;
              return {
                get: jest.fn(() =>
                  Promise.resolve({
                    exists: privateDataStore[key] !== undefined,
                    data: () => privateDataStore[key],
                  })
                ),
              };
            }),
          };
        }),
      })),
    };
  }

  if (name === "mail") {
    return {
      doc: jest.fn(() => {
        generatedMailIdCounter += 1;
        return { id: `generated-mail-id-${generatedMailIdCounter}` };
      }),
    };
  }

  throw new Error(`Unexpected collection ${name}`);
}

const collectionMock = jest.fn((name: string) => buildCollection(name));

// Simula l'atomicita' della transazione Firestore: tx.get legge lo stato
// corrente, tx.set/tx.update accodano scritture applicate solo se la
// callback termina senza eccezioni. Stesso pattern di
// autoCreateProductionChecklist.test.ts.
const runTransactionMock = jest.fn(
  async (
    updateFn: (tx: { get: jest.Mock; set: jest.Mock; update: jest.Mock }) => Promise<unknown>
  ) => {
    const pendingSets: { id: string; data: Record<string, unknown> }[] = [];
    const pendingUpdates: { id: string; data: Record<string, unknown> }[] = [];
    const tx = {
      get: jest.fn((ref: { id: string }) =>
        Promise.resolve({
          exists: deviceRequestsStore[ref.id] !== undefined,
          data: () => deviceRequestsStore[ref.id],
        })
      ),
      set: jest.fn((ref: { id: string }, data: Record<string, unknown>) => {
        pendingSets.push({ id: ref.id, data });
      }),
      update: jest.fn((ref: { id: string }, data: Record<string, unknown>) => {
        pendingUpdates.push({ id: ref.id, data });
      }),
    };
    const result = await updateFn(tx);
    for (const { id, data } of pendingSets) {
      mailStore[id] = data;
    }
    for (const { id, data } of pendingUpdates) {
      deviceRequestsStore[id] = { ...(deviceRequestsStore[id] ?? {}), ...data };
    }
    return result;
  }
);

jest.mock("firebase-admin/firestore", () => ({
  getFirestore: jest.fn(() => ({
    collection: (name: string) => collectionMock(name),
    runTransaction: (
      fn: (tx: { get: jest.Mock; set: jest.Mock; update: jest.Mock }) => Promise<unknown>
    ) => runTransactionMock(fn),
  })),
  FieldValue: {
    serverTimestamp: jest.fn(() => SERVER_TIMESTAMP_SENTINEL),
  },
}));

const logSecurityEventMock = jest.fn().mockResolvedValue(undefined);
jest.mock("../security/securityLog", () => ({
  logSecurityEvent: (...args: unknown[]) => logSecurityEventMock(...args),
}));

import { sendDocumentsEmail } from "./sendDocumentsEmail";

function buildRequest(data: Record<string, unknown>, uid = "admin-1"): CallableRequest {
  return {
    auth: uid ? ({ uid } as CallableRequest["auth"]) : null,
    data,
    rawRequest: { headers: {} } as CallableRequest["rawRequest"],
  } as CallableRequest;
}

describe("sendDocumentsEmail", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    generatedMailIdCounter = 0;

    usersStore = { "admin-1": { role: "admin" }, "volunteer-1": { role: "volunteer" } };
    deviceRequestsStore = {
      "req-1": { requestNumber: "REQ-000001", recipient: "Mario Rossi", documentsEmailSent: false },
    };
    privateDataStore = { "req-1": { email: "famiglia@example.com" } };
    mailStore = {};
  });

  // Scenario 4 EA-160: click sul command button invia l'email tramite il
  // meccanismo a template dell'estensione, imposta il flag e registra un
  // security event.
  it("Scenario 4: sends the templated email, sets documentsEmailSent, and logs a success security event", async () => {
    const result = await sendDocumentsEmail.run(buildRequest({ requestId: "req-1" }));

    expect(result).toEqual({ success: true });
    expect(deviceRequestsStore["req-1"]?.documentsEmailSent).toBe(true);

    const mailDocs = Object.values(mailStore);
    expect(mailDocs).toHaveLength(1);
    expect(mailDocs[0]).toMatchObject({
      to: ["famiglia@example.com"],
      template: {
        name: expect.any(String),
        data: { recipientName: "Mario Rossi", requestNumber: "REQ-000001" },
      },
    });

    expect(logSecurityEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "send_documents_email",
        outcome: "success",
        actor: { uid: "admin-1" },
        context: expect.objectContaining({
          function: "sendDocumentsEmail",
          requestId: "req-1",
        }),
      })
    );
  });

  // Scenario 5 EA-160: doppio click concorrente non genera doppio invio,
  // solo un'invocazione vince il claim in transazione.
  it("Scenario 5: a concurrent second call is rejected as a no-op once the guard is already claimed", async () => {
    // Simula la corsa: la prima invocazione "vince" e claima il guard
    // sincronamente prima che la seconda parta (stesso stile del test di
    // autoCreateProductionChecklist per il caso "vincitore già committato").
    await sendDocumentsEmail.run(buildRequest({ requestId: "req-1" }));

    await expect(sendDocumentsEmail.run(buildRequest({ requestId: "req-1" }))).rejects.toMatchObject({
      code: "failed-precondition",
    });

    // Un solo documento mail scritto, un solo claim del flag.
    expect(Object.values(mailStore)).toHaveLength(1);
    expect(deviceRequestsStore["req-1"]?.documentsEmailSent).toBe(true);

    expect(logSecurityEventMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: "send_documents_email", outcome: "blocked" })
    );
  });

  it("rejects when documentsEmailSent is already true before any transaction attempt", async () => {
    deviceRequestsStore["req-1"] = { ...deviceRequestsStore["req-1"], documentsEmailSent: true };

    await expect(sendDocumentsEmail.run(buildRequest({ requestId: "req-1" }))).rejects.toMatchObject({
      code: "failed-precondition",
    });

    expect(Object.values(mailStore)).toHaveLength(0);
  });

  it("rejects when the requester's email is missing", async () => {
    privateDataStore["req-1"] = {};

    await expect(sendDocumentsEmail.run(buildRequest({ requestId: "req-1" }))).rejects.toMatchObject({
      code: "failed-precondition",
    });

    expect(Object.values(mailStore)).toHaveLength(0);
    expect(deviceRequestsStore["req-1"]?.documentsEmailSent).toBe(false);
  });

  it("rejects when the requester's email is an empty string", async () => {
    privateDataStore["req-1"] = { email: "   " };

    await expect(sendDocumentsEmail.run(buildRequest({ requestId: "req-1" }))).rejects.toMatchObject({
      code: "failed-precondition",
    });
  });

  it("rejects when there is no private data document at all", async () => {
    delete privateDataStore["req-1"];

    await expect(sendDocumentsEmail.run(buildRequest({ requestId: "req-1" }))).rejects.toMatchObject({
      code: "failed-precondition",
    });
  });

  it("rejects unauthenticated calls", async () => {
    await expect(
      sendDocumentsEmail.run(buildRequest({ requestId: "req-1" }, ""))
    ).rejects.toMatchObject({ code: "unauthenticated" });
    expect(Object.values(mailStore)).toHaveLength(0);
  });

  it("rejects non-admin callers", async () => {
    await expect(
      sendDocumentsEmail.run(buildRequest({ requestId: "req-1" }, "volunteer-1"))
    ).rejects.toMatchObject({ code: "permission-denied" });
    expect(Object.values(mailStore)).toHaveLength(0);
  });

  it("rejects a missing requestId", async () => {
    await expect(sendDocumentsEmail.run(buildRequest({}))).rejects.toMatchObject({
      code: "invalid-argument",
    });
  });

  it("rejects when the device request does not exist", async () => {
    // L'email privata e' verificata prima di aprire la transazione: per
    // isolare il caso "documento principale assente" (che la transazione
    // rileva con tx.get) serve comunque un'email valorizzata per quell'id.
    privateDataStore["does-not-exist"] = { email: "famiglia@example.com" };

    await expect(
      sendDocumentsEmail.run(buildRequest({ requestId: "does-not-exist" }))
    ).rejects.toMatchObject({ code: "not-found" });
  });

  it("propagates HttpsError instances unwrapped and still logs a failure security event", async () => {
    // not-found e' lanciato dentro la transazione: verifica che il codice
    // originale sopravviva (non venga rimappato a "internal") e che venga
    // comunque loggato come fallimento.
    privateDataStore["missing-req"] = { email: "famiglia@example.com" };

    await expect(
      sendDocumentsEmail.run(buildRequest({ requestId: "missing-req" }))
    ).rejects.toBeInstanceOf(HttpsError);

    expect(logSecurityEventMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: "send_documents_email", outcome: "failure" })
    );
  });
});
