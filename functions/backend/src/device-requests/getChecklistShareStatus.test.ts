import { HttpsError } from "firebase-functions/v2/https";
import type { CallableRequest } from "firebase-functions/v2/https";

const CHECKLIST_ID = "checklist-1";
const TOKEN = "share-token-1";

let shareLinksStore: Record<string, Record<string, unknown> | undefined>;
let checklistsStore: Record<string, Record<string, unknown> | undefined>;
let checklistItemsStore: Record<string, Record<string, unknown> | undefined>;

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
  });

  // Scenario: Chiunque acceda al link vede solo l'avanzamento macro, senza PII o dettagli interni
  // Scenario 5 (EA-132, non-regressione): la funzione risolve sempre
  // token -> checklistId -> checklists, mai da requestId (il mock delle
  // collection non definisce nemmeno "deviceRequests": qualunque
  // tentativo di risolvere un requestId farebbe fallire il test). Il
  // comportamento e la risposta (solo percentComplete) restano identici,
  // nessuna modifica a getChecklistShareStatus.ts in questa Story.
  //
  // Regressione F-24 (mai corretta qui da EA-138): `checklists/{id}.items`
  // e' un array di soli `itemId` da EA-137, non piu' di oggetti item
  // embedded — il mock riflette la shape reale, risolta via checklistItems.
  it("returns only percentComplete for an anonymous request with no auth", async () => {
    checklistsStore = {
      [CHECKLIST_ID]: { title: "Checklist di fabbricazione", items: ["item-1", "item-2"] },
    };
    checklistItemsStore = {
      "item-1": { assignee: "Mario Rossi", quantity: 2, status: "Completata" },
      "item-2": { assignee: null, quantity: null, status: "Assegnare" },
    };

    const result = await getChecklistShareStatus.run(buildRequest({ token: TOKEN }));

    expect(result).toEqual({ percentComplete: 50 });
    expect(Object.keys(result as object)).toEqual(["percentComplete"]);
  });

  // Scenario 6 (EA-127): il fix del gate di completezza si propaga
  // automaticamente qui senza alcuna modifica a getChecklistShareStatus.ts:
  // un item generic in 'In corso' non viene più conteggiato come completo.
  it("does not count a generic item still 'In corso' as complete (type-aware gate propagation)", async () => {
    checklistsStore = {
      [CHECKLIST_ID]: { title: "Checklist di fabbricazione", items: ["item-1", "item-2"] },
    };
    checklistItemsStore = {
      "item-1": { type: "generic", assignee: "Mario Rossi", quantity: 2, status: "In corso" },
      "item-2": { type: "generic", assignee: "Luigi Bianchi", quantity: 1, status: "Completata" },
    };

    const result = await getChecklistShareStatus.run(buildRequest({ token: TOKEN }));

    expect(result).toEqual({ percentComplete: 50 });
  });

  it("returns 100% for a checklist without items", async () => {
    checklistsStore = { [CHECKLIST_ID]: { items: [] } };

    const result = await getChecklistShareStatus.run(buildRequest({ token: TOKEN }));

    expect(result).toEqual({ percentComplete: 100 });
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
      "item-1": { assignee: "Mario Rossi", quantity: 2, status: "Completata" },
      "item-2": { assignee: "Luigi Bianchi", quantity: 1, status: "Completata" },
    };

    const result = await getChecklistShareStatus.run(buildRequest({ token: TOKEN }));

    expect(result).toEqual({ percentComplete: 100 });
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
      "item-1": { assignee: "Mario Rossi", quantity: 2, status: "Completata" },
    };

    const result = await getChecklistShareStatus.run(buildRequest({ token: TOKEN }));

    expect(result).toEqual({ percentComplete: 100 });
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
