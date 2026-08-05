import type { CallableRequest } from "firebase-functions/v2/https";

const CHECKLIST_ID = "checklist-1";
const SERVER_TIMESTAMP_SENTINEL = { __type: "serverTimestamp" };

let checklistsStore: Record<string, Record<string, unknown> | undefined>;
let checklistItemsStore: Record<string, Record<string, unknown> | undefined>;

jest.mock("firebase-admin/firestore", () => ({
  getFirestore: jest.fn(() => ({
    collection: jest.fn((name: string) => {
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
          doc: jest.fn((id: string) => ({
            id,
            get: jest.fn(() =>
              Promise.resolve({
                exists: checklistItemsStore[id] !== undefined,
                data: () => checklistItemsStore[id],
              })
            ),
            update: jest.fn((updates: Record<string, unknown>) => {
              checklistItemsStore[id] = { ...checklistItemsStore[id], ...updates };
              return Promise.resolve();
            }),
          })),
        };
      }

      throw new Error(`Unexpected collection ${name}`);
    }),
    getAll: jest.fn((...refs: { id: string }[]) =>
      Promise.resolve(
        refs.map((ref) => ({
          id: ref.id,
          exists: checklistItemsStore[ref.id] !== undefined,
          data: () => checklistItemsStore[ref.id],
        }))
      )
    ),
  })),
  FieldValue: {
    serverTimestamp: jest.fn(() => SERVER_TIMESTAMP_SENTINEL),
  },
}));

jest.mock("../security/securityLog", () => ({
  logSecurityEvent: jest.fn().mockResolvedValue(undefined),
}));

import { updateChecklistItem } from "./updateChecklistItem";
import { getChecklistCompleteness } from "./getChecklistCompleteness";

function buildRequest(data: Record<string, unknown>, uid: string | null = "user-1"): CallableRequest {
  return {
    auth: uid ? ({ uid, token: { email: "user@example.com" } } as CallableRequest["auth"]) : undefined,
    data,
    rawRequest: { headers: {} } as CallableRequest["rawRequest"],
  } as CallableRequest;
}

describe("updateChecklistItem + getChecklistCompleteness (integration EA-145/EA-138)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    checklistsStore = {
      [CHECKLIST_ID]: {
        items: ["item-1"],
      },
    };
    checklistItemsStore = {
      "item-1": {
        id: "item-1",
        checklistId: CHECKLIST_ID,
        title: "Verifica dispositivo",
        type: "boolean",
        assignee: "Mario Rossi",
        quantity: null,
        notes: "",
        status: "Assegnare",
        completed: false,
      },
    };
  });

  // EA-145 Scenario: il gate di completezza rileva un item boolean completato
  // dopo l'aggiornamento via updateChecklistItem.
  //
  // Round-trip di regressione per EA-138: updateChecklistItem scrive su
  // `checklistItems/{itemId}` (collection di primo livello, EA-137) e
  // getChecklistCompleteness risolve lo stesso documento (resolveChecklistItems,
  // EA-138) prima di applicare il gate — riattivato dopo essere rimasto
  // temporaneamente skippato da EA-137 (F-24) in attesa di questa Story.
  it("reports the checklist as complete after updateChecklistItem sets completed=true on the only boolean item", async () => {
    const before = await getChecklistCompleteness.run(buildRequest({ checklistId: CHECKLIST_ID }));
    expect(before).toEqual({ checklistId: CHECKLIST_ID, complete: false });

    await updateChecklistItem.run(
      buildRequest({ checklistId: CHECKLIST_ID, itemId: "item-1", completed: true })
    );

    const after = await getChecklistCompleteness.run(buildRequest({ checklistId: CHECKLIST_ID }));
    expect(after).toEqual({ checklistId: CHECKLIST_ID, complete: true });
  });
});
