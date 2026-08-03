import { HttpsError } from "firebase-functions/v2/https";
import type { CallableRequest } from "firebase-functions/v2/https";

const CHECKLIST_ID = "checklist-1";
const TOKEN = "share-token-1";

let shareLinksStore: Record<string, Record<string, unknown> | undefined>;
let checklistsStore: Record<string, Record<string, unknown> | undefined>;

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

  throw new Error(`Unexpected collection ${name}`);
}

const collectionMock = jest.fn((name: string) => buildCollection(name));

jest.mock("firebase-admin/firestore", () => ({
  getFirestore: jest.fn(() => ({
    collection: (name: string) => collectionMock(name),
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
  });

  // Scenario: Chiunque acceda al link vede solo l'avanzamento macro, senza PII o dettagli interni
  it("returns only percentComplete for an anonymous request with no auth", async () => {
    checklistsStore = {
      [CHECKLIST_ID]: {
        title: "Checklist di fabbricazione",
        items: [
          { assignee: "Mario Rossi", quantity: 2, status: "Completata" },
          { assignee: null, quantity: null, status: "Assegnare" },
        ],
      },
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
      [CHECKLIST_ID]: {
        title: "Checklist di fabbricazione",
        items: [
          { type: "generic", assignee: "Mario Rossi", quantity: 2, status: "In corso" },
          { type: "generic", assignee: "Luigi Bianchi", quantity: 1, status: "Completata" },
        ],
      },
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
    checklistsStore = {
      [CHECKLIST_ID]: {
        items: [
          { assignee: "Mario Rossi", quantity: 2, status: "Completata" },
          { assignee: "Luigi Bianchi", quantity: 1, status: "Completata" },
        ],
      },
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
