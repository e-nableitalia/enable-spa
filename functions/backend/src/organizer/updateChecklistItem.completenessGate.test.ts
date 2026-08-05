import type { CallableRequest } from "firebase-functions/v2/https";

const CHECKLIST_ID = "checklist-1";
const SERVER_TIMESTAMP_SENTINEL = { __type: "serverTimestamp" };

let checklistsStore: Record<string, Record<string, unknown> | undefined>;

jest.mock("firebase-admin/firestore", () => ({
  getFirestore: jest.fn(() => ({
    collection: jest.fn((name: string) => {
      if (name !== "checklists") {
        throw new Error(`Unexpected collection ${name}`);
      }
      return {
        doc: jest.fn((id: string) => ({
          get: jest.fn(() =>
            Promise.resolve({
              exists: checklistsStore[id] !== undefined,
              data: () => checklistsStore[id],
            })
          ),
          update: jest.fn((updates: Record<string, unknown>) => {
            checklistsStore[id] = { ...checklistsStore[id], items: updates.items };
            return Promise.resolve();
          }),
        })),
      };
    }),
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

describe("updateChecklistItem + getChecklistCompleteness (integration EA-145)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    checklistsStore = {
      [CHECKLIST_ID]: {
        items: [
          {
            id: "item-1",
            title: "Verifica dispositivo",
            type: "boolean",
            assignee: "Mario Rossi",
            quantity: null,
            notes: "",
            status: "Assegnare",
            completed: false,
          },
        ],
      },
    };
  });

  // EA-145 Scenario: il gate di completezza rileva un item boolean completato
  // dopo l'aggiornamento via updateChecklistItem.
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
