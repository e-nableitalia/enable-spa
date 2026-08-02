import { HttpsError } from "firebase-functions/v2/https";
import type { CallableRequest } from "firebase-functions/v2/https";

const SERVER_TIMESTAMP_SENTINEL = { __type: "serverTimestamp" };
const SOURCE_CHECKLIST_ID = "existing-checklist-id";
const GENERATED_CHECKLIST_ID = "generated-checklist-id";

/**
 * Store in-memory minimale che simula la collection `checklists` da cui
 * viene letta la checklist sorgente della clonazione.
 */
let checklistsStore: Record<string, Record<string, unknown> | undefined>;

const setMock = jest.fn().mockResolvedValue(undefined);
const newChecklistDocMock = jest.fn(() => ({ id: GENERATED_CHECKLIST_ID, set: setMock }));

function buildCollection() {
  return {
    doc: jest.fn((id?: string) => {
      if (id === undefined) {
        // db.collection("checklists").doc() senza argomenti: genera il
        // riferimento alla nuova istanza da creare.
        return newChecklistDocMock();
      }

      return {
        get: jest.fn(() => {
          const data = checklistsStore[id];
          return Promise.resolve({
            exists: data !== undefined,
            data: () => data,
          });
        }),
      };
    }),
  };
}

const collectionMock = jest.fn(() => buildCollection());

jest.mock("firebase-admin/firestore", () => ({
  getFirestore: jest.fn(() => ({
    collection: () => collectionMock(),
  })),
  FieldValue: {
    serverTimestamp: jest.fn(() => SERVER_TIMESTAMP_SENTINEL),
  },
}));

jest.mock("../security/securityLog", () => ({
  logSecurityEvent: jest.fn().mockResolvedValue(undefined),
}));

import { logSecurityEvent } from "../security/securityLog";
import { cloneChecklist } from "./cloneChecklist";

function buildRequest(data: Record<string, unknown>, uid: string | null = "user-1"): CallableRequest {
  return {
    auth: uid ? ({ uid } as CallableRequest["auth"]) : undefined,
    data,
    rawRequest: { headers: {} } as CallableRequest["rawRequest"],
  } as CallableRequest;
}

describe("cloneChecklist", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setMock.mockResolvedValue(undefined);

    checklistsStore = {
      [SOURCE_CHECKLIST_ID]: {
        category: "devicetype-arto-superiore",
        title: "Checklist evento passato",
        items: [
          {
            id: "item-1",
            title: "Prepara stampante",
            type: "boolean",
            assignee: "vol-1",
            quantity: 2,
            notes: "Nota storica",
            status: "Completata",
            completed: true,
          },
          {
            id: "item-2",
            title: "Verifica materiale",
            type: "numeric",
            assignee: null,
            quantity: null,
            notes: "",
            status: "Da iniziare",
            completed: false,
          },
        ],
      },
    };
  });

  it("clones source instance items into the new instance resetting status, assignee and completed", async () => {
    await cloneChecklist.run(
      buildRequest({ sourceChecklistId: SOURCE_CHECKLIST_ID, title: "Checklist nuova occasione" })
    );

    expect(setMock).toHaveBeenCalledTimes(1);
    const [savedDocument] = setMock.mock.calls[0];

    expect(savedDocument.items).toEqual([
      {
        id: expect.any(String),
        title: "Prepara stampante",
        type: "boolean",
        assignee: null,
        quantity: 2,
        notes: "",
        status: "Assegnare",
        completed: false,
      },
      {
        id: expect.any(String),
        title: "Verifica materiale",
        type: "numeric",
        assignee: null,
        quantity: null,
        notes: "",
        status: "Assegnare",
        completed: false,
      },
    ]);

    // ogni item clonato ha un id univoco generato per la nuova istanza,
    // distinto dall'id che l'item aveva nella sorgente.
    const ids = savedDocument.items.map((item: { id: string }) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).not.toContain("item-1");
    expect(ids).not.toContain("item-2");
  });

  it("resets status, assignee and completed even when cloning from a fully completed source checklist", async () => {
    checklistsStore[SOURCE_CHECKLIST_ID] = {
      category: "devicetype-arto-superiore",
      title: "Checklist completata",
      items: [
        { id: "item-1", title: "Task A", type: "generic", assignee: "vol-1", quantity: 1, notes: "x", status: "Completata", completed: true },
        { id: "item-2", title: "Task B", type: "numeric", assignee: "vol-2", quantity: 3, notes: "y", status: "Completata", completed: true },
      ],
    };

    await cloneChecklist.run(
      buildRequest({ sourceChecklistId: SOURCE_CHECKLIST_ID, title: "Checklist ripetuta" })
    );

    const [savedDocument] = setMock.mock.calls[0];
    for (const item of savedDocument.items) {
      expect(item.status).toBe("Assegnare");
      expect(item.assignee).toBeNull();
      expect(item.completed).toBe(false);
    }
    expect(savedDocument.items[0].title).toBe("Task A");
    expect(savedDocument.items[0].quantity).toBe(1);
    expect(savedDocument.items[1].title).toBe("Task B");
    expect(savedDocument.items[1].quantity).toBe(3);
  });

  it("propagates the type of the source item onto the cloned instance item, regardless of source progress (Scenario 2)", async () => {
    checklistsStore[SOURCE_CHECKLIST_ID] = {
      category: "devicetype-arto-superiore",
      title: "Checklist con item in stati diversi",
      items: [
        { id: "item-1", title: "Item boolean completato", type: "boolean", assignee: "vol-1", quantity: null, notes: "", status: "Completata", completed: true },
        { id: "item-2", title: "Item generic non iniziato", type: "generic", assignee: null, quantity: null, notes: "", status: "Assegnare", completed: false },
        { id: "item-3", title: "Item numeric in corso", type: "numeric", assignee: "vol-2", quantity: 5, notes: "", status: "In corso", completed: false },
      ],
    };

    await cloneChecklist.run(
      buildRequest({ sourceChecklistId: SOURCE_CHECKLIST_ID, title: "Checklist nuova occasione" })
    );

    const [savedDocument] = setMock.mock.calls[0];
    expect(savedDocument.items.map((item: { type: string }) => item.type)).toEqual([
      "boolean",
      "generic",
      "numeric",
    ]);
  });

  it("defaults type to 'generic' when a legacy source item has no type (pre-EA-123 data)", async () => {
    checklistsStore[SOURCE_CHECKLIST_ID] = {
      category: "devicetype-arto-superiore",
      title: "Checklist legacy",
      items: [
        { id: "item-1", title: "Item legacy senza type", assignee: null, quantity: null, notes: "", status: "Assegnare", completed: false },
      ],
    };

    await cloneChecklist.run(
      buildRequest({ sourceChecklistId: SOURCE_CHECKLIST_ID, title: "Checklist nuova occasione" })
    );

    const [savedDocument] = setMock.mock.calls[0];
    expect(savedDocument.items[0].type).toBe("generic");
  });

  it("registers clonedFrom as a historical reference to the source checklist", async () => {
    await cloneChecklist.run(
      buildRequest({ sourceChecklistId: SOURCE_CHECKLIST_ID, title: "Checklist nuova occasione" })
    );

    const [savedDocument] = setMock.mock.calls[0];
    expect(savedDocument.clonedFrom).toBe(SOURCE_CHECKLIST_ID);
  });

  it("inherits the category from the source checklist when not overridden by the consumer", async () => {
    await cloneChecklist.run(
      buildRequest({ sourceChecklistId: SOURCE_CHECKLIST_ID, title: "Checklist nuova occasione" })
    );

    const [savedDocument] = setMock.mock.calls[0];
    expect(savedDocument.category).toBe("devicetype-arto-superiore");
  });

  it("overrides the category with the one provided by the consumer", async () => {
    await cloneChecklist.run(
      buildRequest({
        sourceChecklistId: SOURCE_CHECKLIST_ID,
        title: "Checklist nuova occasione",
        category: "devicetype-mano",
      })
    );

    const [savedDocument] = setMock.mock.calls[0];
    expect(savedDocument.category).toBe("devicetype-mano");
  });

  it("saves the title and createdAt provided by the consumer", async () => {
    await cloneChecklist.run(
      buildRequest({ sourceChecklistId: SOURCE_CHECKLIST_ID, title: "Checklist nuova occasione" })
    );

    const [savedDocument] = setMock.mock.calls[0];
    expect(savedDocument.title).toBe("Checklist nuova occasione");
    expect(savedDocument.createdAt).toBe(SERVER_TIMESTAMP_SENTINEL);
  });

  it("returns the generated checklistId to the consumer", async () => {
    const result = await cloneChecklist.run(
      buildRequest({ sourceChecklistId: SOURCE_CHECKLIST_ID, title: "Checklist nuova occasione" })
    );

    expect(result).toEqual({ checklistId: GENERATED_CHECKLIST_ID });
  });

  it("writes createdBy with the authenticated caller's uid", async () => {
    await cloneChecklist.run(
      buildRequest(
        { sourceChecklistId: SOURCE_CHECKLIST_ID, title: "Checklist nuova occasione" },
        "user-42"
      )
    );

    const [savedDocument] = setMock.mock.calls[0];
    expect(savedDocument.createdBy).toBe("user-42");
  });

  it("creates an instance with no items when the source checklist has none", async () => {
    checklistsStore[SOURCE_CHECKLIST_ID] = {
      category: "devicetype-arto-superiore",
      title: "Checklist vuota",
      items: [],
    };

    await cloneChecklist.run(
      buildRequest({ sourceChecklistId: SOURCE_CHECKLIST_ID, title: "Checklist nuova occasione" })
    );

    const [savedDocument] = setMock.mock.calls[0];
    expect(savedDocument.items).toEqual([]);
  });

  it("throws not-found when the source checklist does not exist", async () => {
    await expect(
      cloneChecklist.run(
        buildRequest({ sourceChecklistId: "missing-checklist", title: "Checklist nuova occasione" })
      )
    ).rejects.toMatchObject(new HttpsError("not-found", "Source checklist not found"));

    expect(setMock).not.toHaveBeenCalled();
  });

  it("throws unauthenticated when there is no auth context", async () => {
    await expect(
      cloneChecklist.run(
        buildRequest({ sourceChecklistId: SOURCE_CHECKLIST_ID, title: "Checklist nuova occasione" }, null)
      )
    ).rejects.toMatchObject(new HttpsError("unauthenticated", "Authentication required"));

    expect(setMock).not.toHaveBeenCalled();
  });

  it("throws invalid-argument when sourceChecklistId is missing", async () => {
    await expect(
      cloneChecklist.run(buildRequest({ title: "Checklist nuova occasione" }))
    ).rejects.toMatchObject(new HttpsError("invalid-argument", "Missing or invalid sourceChecklistId"));

    expect(setMock).not.toHaveBeenCalled();
  });

  it("throws invalid-argument when title is missing", async () => {
    await expect(
      cloneChecklist.run(buildRequest({ sourceChecklistId: SOURCE_CHECKLIST_ID }))
    ).rejects.toMatchObject(new HttpsError("invalid-argument", "Missing or invalid title"));

    expect(setMock).not.toHaveBeenCalled();
  });

  it("throws invalid-argument when category is not a string", async () => {
    await expect(
      cloneChecklist.run(
        buildRequest({
          sourceChecklistId: SOURCE_CHECKLIST_ID,
          title: "Checklist nuova occasione",
          category: 123,
        })
      )
    ).rejects.toMatchObject(new HttpsError("invalid-argument", "category must be a string"));

    expect(setMock).not.toHaveBeenCalled();
  });

  it("logs a success security event when the checklist is cloned", async () => {
    await cloneChecklist.run(
      buildRequest({ sourceChecklistId: SOURCE_CHECKLIST_ID, title: "Checklist nuova occasione" })
    );

    expect(logSecurityEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "clone_checklist",
        outcome: "success",
        context: expect.objectContaining({ function: "cloneChecklist" }),
      })
    );
  });

  it("logs a failure security event when the source checklist does not exist", async () => {
    await expect(
      cloneChecklist.run(
        buildRequest({ sourceChecklistId: "missing-checklist", title: "Checklist nuova occasione" })
      )
    ).rejects.toBeInstanceOf(HttpsError);

    expect(logSecurityEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "clone_checklist_failed",
        outcome: "failure",
        context: expect.objectContaining({ function: "cloneChecklist" }),
      })
    );
  });
});
