import { HttpsError } from "firebase-functions/v2/https";
import type { CallableRequest } from "firebase-functions/v2/https";

const CHECKLIST_ID = "checklist-1";
const TOKEN = "share-token-1";

let shareLinksStore: Record<string, Record<string, unknown> | undefined>;
let checklistsStore: Record<string, Record<string, unknown> | undefined>;
let checklistItemsStore: Record<string, Record<string, unknown> | undefined>;
let publicDeviceRequestsStore: Record<string, Record<string, unknown> | undefined>;

function buildCollection(name: string) {
  if (name === "checklistShareLinks") {
    return {
      doc: jest.fn((token: string) => ({
        get: jest.fn(() =>
          Promise.resolve({
            exists: shareLinksStore[token] !== undefined,
            data: () => shareLinksStore[token],
          })
        ),
      })),
    };
  }

  if (name === "publicDeviceRequests") {
    return {
      doc: jest.fn((id: string) => ({
        get: jest.fn(() =>
          Promise.resolve({
            exists: publicDeviceRequestsStore[id] !== undefined,
            data: () => publicDeviceRequestsStore[id],
          })
        ),
      })),
    };
  }

  if (name === "checklists") {
    return {
      doc: jest.fn((id: string) => ({
        get: jest.fn(() =>
          Promise.resolve({
            exists: checklistsStore[id] !== undefined,
            data: () => checklistsStore[id],
          })
        ),
      })),
    };
  }

  if (name === "checklistItems") {
    return {
      doc: jest.fn((id: string) => ({ id, __kind: "checklistItemRef" as const })),
    };
  }

  throw new Error(`Unexpected collection ${name}`);
}

const collectionMock = jest.fn((name: string) => buildCollection(name));

// resolveChecklistItems.ts fa db.getAll(...refs): il mock simula esattamente
// quella firma, risolvendo ogni ref da checklistItemsStore per id — stesso
// pattern gia' usato da getChecklist.test.ts/getChecklistCompleteness.test.ts.
const getAllMock = jest.fn((...refs: { id: string }[]) =>
  Promise.resolve(
    refs.map((ref) => ({
      exists: checklistItemsStore[ref.id] !== undefined,
      data: () => checklistItemsStore[ref.id],
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

import { getChecklistShareStatus } from "./getChecklistShareStatus";

function buildRequest(data: Record<string, unknown>): CallableRequest {
  return {
    auth: undefined,
    data,
    rawRequest: { ip: "203.0.113.5", headers: {} } as unknown as CallableRequest["rawRequest"],
  } as CallableRequest;
}

describe("getChecklistShareStatus", () => {
  beforeEach(() => {
    jest.clearAllMocks();

    shareLinksStore = {
      [TOKEN]: {
        checklistId: CHECKLIST_ID,
        requestId: "req-1",
        createdAt: { seconds: 1, nanoseconds: 0 },
      },
    };
    checklistItemsStore = {};
    publicDeviceRequestsStore = {};
  });

  // Scenario: Chiunque acceda al link vede l'avanzamento macro e l'elenco
  // item semplificato (title + completed), senza PII o dettagli interni
  // Scenario 5 (EA-132, non-regressione): la funzione risolve sempre
  // token -> checklistId -> checklists, mai da requestId (il mock delle
  // collection non definisce nemmeno "deviceRequests": qualunque
  // tentativo di risolvere un requestId farebbe fallire il test).
  //
  // Regressione F-24 (mai corretta qui da EA-138): `checklists/{id}.items`
  // e' un array di soli `itemId` da EA-137, non piu' di oggetti item
  // embedded — il mock riflette la shape reale, risolta via checklistItems.
  it("returns percentComplete, requestNumber, and a simplified items list (title + completed only) for an anonymous request", async () => {
    checklistsStore = {
      [CHECKLIST_ID]: { title: "Checklist di fabbricazione", items: ["item-1", "item-2"] },
    };
    checklistItemsStore = {
      "item-1": { title: "Stampa mano", assignee: "Mario Rossi", quantity: 2, notes: "Nota interna", status: "Completata" },
      "item-2": { title: "Verifica misure", assignee: null, quantity: null, status: "Assegnare" },
    };
    publicDeviceRequestsStore = {
      "req-1": { requestNumber: "REQ-000137", province: "TO", devicetype: "Kinetic Hand" },
    };

    const result = await getChecklistShareStatus.run(buildRequest({ token: TOKEN }));

    expect(result).toEqual({
      percentComplete: 50,
      requestNumber: "REQ-000137",
      items: [
        { title: "Stampa mano", completed: true },
        { title: "Verifica misure", completed: false },
      ],
    });
    // Confine dc-private-data-separation: ogni item espone solo title e
    // completed, mai assegnatario/note/quantita'/status grezzo. requestNumber
    // e' gia' un campo pubblico (letto da publicDeviceRequests), non
    // un'estensione del confine.
    expect(Object.keys(result as { items: object[] }).sort()).toEqual(
      ["items", "percentComplete", "requestNumber"]
    );
    (result as { items: object[] }).items.forEach((item) => {
      expect(Object.keys(item).sort()).toEqual(["completed", "title"]);
    });
  });

  // Regressione: requestNumber non deve mai essere letto dal documento
  // principale deviceRequests (dati potenzialmente sensibili), solo dalla
  // proiezione pubblica — il mock qui sotto non definisce affatto la
  // collection "deviceRequests": un tentativo di leggerla farebbe fallire
  // il test con "Unexpected collection deviceRequests".
  it("resolves requestNumber only from publicDeviceRequests, never from the main deviceRequests document", async () => {
    checklistsStore = { [CHECKLIST_ID]: { items: [] } };
    publicDeviceRequestsStore = { "req-1": { requestNumber: "REQ-000042" } };

    const result = await getChecklistShareStatus.run(buildRequest({ token: TOKEN }));

    expect(result).toEqual({ percentComplete: 100, requestNumber: "REQ-000042", items: [] });
  });

  // requestNumber non deve mai bloccare la risposta: un link il cui
  // requestId non risolve piu' a una publicDeviceRequests reale mostra
  // comunque l'avanzamento, solo senza numero richiesta.
  it("returns requestNumber: null when the linked request is not resolvable in publicDeviceRequests, without failing", async () => {
    checklistsStore = { [CHECKLIST_ID]: { items: [] } };
    // publicDeviceRequestsStore resta vuoto: nessun documento per "req-1".

    const result = await getChecklistShareStatus.run(buildRequest({ token: TOKEN }));

    expect(result).toEqual({ percentComplete: 100, requestNumber: null, items: [] });
  });

  // Scenario 6 (EA-127): il fix del gate di completezza si propaga
  // automaticamente qui senza alcuna modifica a getChecklistShareStatus.ts:
  // un item generic in 'In corso' non viene più conteggiato come completo.
  it("does not count a generic item still 'In corso' as complete (type-aware gate propagation)", async () => {
    checklistsStore = {
      [CHECKLIST_ID]: { title: "Checklist di fabbricazione", items: ["item-1", "item-2"] },
    };
    checklistItemsStore = {
      "item-1": { title: "Item 1", type: "generic", assignee: "Mario Rossi", quantity: 2, status: "In corso" },
      "item-2": { title: "Item 2", type: "generic", assignee: "Luigi Bianchi", quantity: 1, status: "Completata" },
    };

    const result = await getChecklistShareStatus.run(buildRequest({ token: TOKEN }));

    expect(result).toEqual({
      percentComplete: 50,
      requestNumber: null,
      items: [
        { title: "Item 1", completed: false },
        { title: "Item 2", completed: true },
      ],
    });
  });

  it("returns 100% and an empty items list for a checklist without items", async () => {
    checklistsStore = { [CHECKLIST_ID]: { items: [] } };

    const result = await getChecklistShareStatus.run(buildRequest({ token: TOKEN }));

    expect(result).toEqual({ percentComplete: 100, requestNumber: null, items: [] });
  });

  // Scenario: Il link non scade e resta valido indefinitamente
  it("stays valid and reflects up-to-date progress no matter how old the link is, with no expiry/renewal logic", async () => {
    shareLinksStore = {
      [TOKEN]: {
        checklistId: CHECKLIST_ID,
        requestId: "req-1",
        createdAt: { seconds: 1, nanoseconds: 0 }, // link generato "in passato"
      },
    };
    checklistsStore = { [CHECKLIST_ID]: { items: ["item-1", "item-2"] } };
    checklistItemsStore = {
      "item-1": { title: "Item 1", assignee: "Mario Rossi", quantity: 2, status: "Completata" },
      "item-2": { title: "Item 2", assignee: "Luigi Bianchi", quantity: 1, status: "Completata" },
    };

    const result = await getChecklistShareStatus.run(buildRequest({ token: TOKEN }));

    expect(result).toEqual({
      percentComplete: 100,
      requestNumber: null,
      items: [
        { title: "Item 1", completed: true },
        { title: "Item 2", completed: true },
      ],
    });
  });

  // Regressione F-24: prima del fix, un item non ancora migrato al nuovo
  // storage (checklistItems assente, es. documento cancellato o mai
  // risolvibile) veniva comunque conteggiato come "presente" (una stringa
  // sempre non-completa) invece di essere escluso — resolveChecklistItems
  // filtra i soli snapshot esistenti, coerente con getChecklist/
  // getChecklistCompleteness.
  it("ignores an itemId that no longer resolves to a real checklistItems document", async () => {
    checklistsStore = { [CHECKLIST_ID]: { items: ["item-1", "item-missing"] } };
    checklistItemsStore = {
      "item-1": { title: "Item 1", assignee: "Mario Rossi", quantity: 2, status: "Completata" },
    };

    const result = await getChecklistShareStatus.run(buildRequest({ token: TOKEN }));

    expect(result).toEqual({
      percentComplete: 100,
      requestNumber: null,
      items: [{ title: "Item 1", completed: true }],
    });
  });

  // Rappresentazione omogenea richiesta dall'operatore: un item boolean
  // e' completo/non completo tramite `completed`, non `status` (che per
  // un boolean non ha alcun ruolo nel gate) — stesso flag semplificato
  // di un item generic/numeric, senza distinzione di type nella risposta.
  it("derives completed for a boolean item from its completed flag, not its status", async () => {
    checklistsStore = { [CHECKLIST_ID]: { items: ["item-1", "item-2"] } };
    checklistItemsStore = {
      "item-1": { title: "Verifica batteria", type: "boolean", assignee: "Mario Rossi", status: "Assegnare", completed: true },
      "item-2": { title: "Controllo cinghia", type: "boolean", assignee: "Luigi Bianchi", status: "Completata", completed: false },
    };

    const result = await getChecklistShareStatus.run(buildRequest({ token: TOKEN }));

    expect(result).toEqual({
      percentComplete: 50,
      requestNumber: null,
      items: [
        { title: "Verifica batteria", completed: true },
        { title: "Controllo cinghia", completed: false },
      ],
    });
  });

  it("throws not-found for an unknown or mistyped token", async () => {
    await expect(
      getChecklistShareStatus.run(buildRequest({ token: "unknown-token" }))
    ).rejects.toMatchObject(new HttpsError("not-found", "Share link not found"));
  });

  it("throws invalid-argument when token is missing", async () => {
    await expect(
      getChecklistShareStatus.run(buildRequest({}))
    ).rejects.toMatchObject(new HttpsError("invalid-argument", "Missing parameter: token"));

    expect(collectionMock).not.toHaveBeenCalled();
  });

  it("throws not-found when the linked checklist no longer exists", async () => {
    checklistsStore = {};

    await expect(
      getChecklistShareStatus.run(buildRequest({ token: TOKEN }))
    ).rejects.toMatchObject(new HttpsError("not-found", "Checklist not found"));
  });
});
