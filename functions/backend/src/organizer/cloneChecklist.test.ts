import { HttpsError } from "firebase-functions/v2/https";
import type { CallableRequest } from "firebase-functions/v2/https";

const SERVER_TIMESTAMP_SENTINEL = { __type: "serverTimestamp" };
const SOURCE_CHECKLIST_ID = "existing-checklist-id";
const GENERATED_CHECKLIST_ID = "generated-checklist-id";

/**
 * Store in-memory minimale che simula le collection `checklists` (la
 * checklist sorgente, con `items` come array di soli `itemId`, EA-137) e
 * `checklistItems` (i documenti reali risolti dalla sorgente) da cui legge
 * la clonazione.
 */
let checklistsStore: Record<string, Record<string, unknown> | undefined>;
let checklistItemsStore: Record<string, Record<string, unknown> | undefined>;

const checklistDocMock = jest.fn();
const getAllMock = jest.fn();
const batchSetMock = jest.fn();
const batchCommitMock = jest.fn().mockResolvedValue(undefined);

let generatedItemCounter = 0;

function checklistItemDoc(id?: string) {
  if (id !== undefined) {
    return { id };
  }
  generatedItemCounter += 1;
  return { id: `generated-item-id-${generatedItemCounter}` };
}

const checklistItemDocMock = jest.fn(checklistItemDoc);

function buildCollection(name: string) {
  if (name === "checklists") {
    return {
      doc: jest.fn((id?: string) => {
        if (id === undefined) {
          return { id: GENERATED_CHECKLIST_ID };
        }
        return checklistDocMock(id);
      }),
    };
  }

  return { doc: checklistItemDocMock };
}

const collectionMock = jest.fn((name: string) => buildCollection(name));

jest.mock("firebase-admin/firestore", () => ({
  getFirestore: jest.fn(() => ({
    collection: (name: string) => collectionMock(name),
    getAll: getAllMock,
    batch: jest.fn(() => ({
      set: batchSetMock,
      commit: batchCommitMock,
    })),
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
    generatedItemCounter = 0;
    batchCommitMock.mockResolvedValue(undefined);

    checklistsStore = {
      [SOURCE_CHECKLIST_ID]: {
        category: "devicetype-arto-superiore",
        title: "Checklist evento passato",
        items: ["item-1", "item-2"],
      },
    };
    checklistItemsStore = {
      "item-1": {
        id: "item-1",
        checklistId: SOURCE_CHECKLIST_ID,
        category: "devicetype-arto-superiore",
        title: "Prepara stampante",
        type: "boolean",
        assignee: "vol-1",
        quantity: 2,
        notes: "Nota storica",
        status: "Completata",
        completed: true,
        creationDate: { seconds: 1, nanoseconds: 0 },
        dueDate: null,
        completionDate: { seconds: 2, nanoseconds: 0 },
      },
      "item-2": {
        id: "item-2",
        checklistId: SOURCE_CHECKLIST_ID,
        category: "devicetype-arto-superiore",
        title: "Verifica materiale",
        type: "numeric",
        assignee: null,
        quantity: null,
        notes: "",
        status: "Da iniziare",
        completed: false,
        creationDate: { seconds: 1, nanoseconds: 0 },
        dueDate: null,
        completionDate: null,
      },
    };

    checklistDocMock.mockImplementation((id: string) => ({
      get: jest.fn(() => {
        const data = checklistsStore[id];
        return Promise.resolve({ exists: data !== undefined, data: () => data });
      }),
    }));
    getAllMock.mockImplementation((...refs: { id: string }[]) =>
      Promise.resolve(
        refs.map((ref) => {
          const data = checklistItemsStore[ref.id];
          return { id: ref.id, exists: data !== undefined, data: () => data };
        })
      )
    );
  });

  function savedChecklistDocument() {
    const call = batchSetMock.mock.calls.find(([ref]) => ref.id === GENERATED_CHECKLIST_ID);
    return call?.[1];
  }

  function savedItemDocuments() {
    return batchSetMock.mock.calls
      .filter(([ref]) => ref.id !== GENERATED_CHECKLIST_ID)
      .map(([, document]) => document);
  }

  // Scenario: cloneChecklist crea checklistItems azzerati indipendentemente dallo stato della sorgente
  it("clones source instance items into new checklistItems documents resetting status, assignee, notes and completed", async () => {
    await cloneChecklist.run(
      buildRequest({ sourceChecklistId: SOURCE_CHECKLIST_ID, title: "Checklist nuova occasione" })
    );

    expect(getAllMock).toHaveBeenCalledTimes(1);
    const items = savedItemDocuments();
    expect(items).toEqual([
      {
        id: expect.any(String),
        checklistId: GENERATED_CHECKLIST_ID,
        category: "devicetype-arto-superiore",
        title: "Prepara stampante",
        type: "boolean",
        assignee: null,
        quantity: 2,
        notes: "",
        status: "Assegnare",
        completed: false,
        creationDate: null,
        dueDate: null,
        completionDate: null,
      },
      {
        id: expect.any(String),
        checklistId: GENERATED_CHECKLIST_ID,
        category: "devicetype-arto-superiore",
        title: "Verifica materiale",
        type: "numeric",
        assignee: null,
        quantity: null,
        notes: "",
        status: "Assegnare",
        completed: false,
        creationDate: null,
        dueDate: null,
        completionDate: null,
      },
    ]);

    const ids = items.map((item) => (item as { id: string }).id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).not.toContain("item-1");
    expect(ids).not.toContain("item-2");
  });

  // Scenario: cloneChecklist crea checklistItems azzerati indipendentemente dallo stato della sorgente
  it("resets status, assignee, dates and completed even when cloning from a fully completed source checklist", async () => {
    checklistItemsStore["item-1"] = { ...checklistItemsStore["item-1"], status: "Completata", completed: true, assignee: "vol-1" };
    checklistItemsStore["item-2"] = { ...checklistItemsStore["item-2"], status: "Completata", completed: true, assignee: "vol-2", quantity: 3 };

    await cloneChecklist.run(
      buildRequest({ sourceChecklistId: SOURCE_CHECKLIST_ID, title: "Checklist ripetuta" })
    );

    for (const item of savedItemDocuments()) {
      const typedItem = item as Record<string, unknown>;
      expect(typedItem.status).toBe("Assegnare");
      expect(typedItem.assignee).toBeNull();
      expect(typedItem.completed).toBe(false);
      expect(typedItem.creationDate).toBeNull();
      expect(typedItem.dueDate).toBeNull();
      expect(typedItem.completionDate).toBeNull();
    }
  });

  // Scenario 2 (regression, EA-126): propagazione del type indipendentemente dallo stato della sorgente
  it("propagates the type of the source item onto the cloned instance item, regardless of source progress", async () => {
    checklistsStore[SOURCE_CHECKLIST_ID] = {
      category: "devicetype-arto-superiore",
      title: "Checklist con item in stati diversi",
      items: ["item-1", "item-2", "item-3"],
    };
    checklistItemsStore["item-3"] = {
      id: "item-3",
      checklistId: SOURCE_CHECKLIST_ID,
      category: "devicetype-arto-superiore",
      title: "Item numeric in corso",
      type: "numeric",
      assignee: "vol-2",
      quantity: 5,
      notes: "",
      status: "In corso",
      completed: false,
      creationDate: { seconds: 1, nanoseconds: 0 },
      dueDate: null,
      completionDate: null,
    };

    await cloneChecklist.run(
      buildRequest({ sourceChecklistId: SOURCE_CHECKLIST_ID, title: "Checklist nuova occasione" })
    );

    expect(savedItemDocuments().map((item) => (item as { type: string }).type)).toEqual([
      "boolean",
      "numeric",
      "numeric",
    ]);
  });

  it("defaults type to 'generic' when a legacy source item has no type (pre-EA-123 data)", async () => {
    checklistsStore[SOURCE_CHECKLIST_ID] = {
      category: "devicetype-arto-superiore",
      title: "Checklist legacy",
      items: ["item-1"],
    };
    checklistItemsStore["item-1"] = {
      id: "item-1",
      checklistId: SOURCE_CHECKLIST_ID,
      title: "Item legacy senza type",
      assignee: null,
      quantity: null,
      notes: "",
      status: "Assegnare",
      completed: false,
    };

    await cloneChecklist.run(
      buildRequest({ sourceChecklistId: SOURCE_CHECKLIST_ID, title: "Checklist nuova occasione" })
    );

    expect((savedItemDocuments()[0] as { type: string }).type).toBe("generic");
  });

  // Scenario: cloneChecklist crea checklistItems azzerati indipendentemente dallo stato della sorgente
  it("denormalizes the new checklist's category (not the source item's) onto every cloned checklistItems document", async () => {
    await cloneChecklist.run(
      buildRequest({
        sourceChecklistId: SOURCE_CHECKLIST_ID,
        title: "Checklist nuova occasione",
        category: "devicetype-mano",
      })
    );

    for (const item of savedItemDocuments()) {
      expect((item as { category: string }).category).toBe("devicetype-mano");
    }
  });

  // Scenario: cloneChecklist crea checklistItems azzerati indipendentemente dallo stato della sorgente
  it("registers clonedFrom as a historical reference to the source checklist", async () => {
    await cloneChecklist.run(
      buildRequest({ sourceChecklistId: SOURCE_CHECKLIST_ID, title: "Checklist nuova occasione" })
    );

    expect(savedChecklistDocument()?.clonedFrom).toBe(SOURCE_CHECKLIST_ID);
  });

  it("inherits the category from the source checklist when not overridden by the consumer", async () => {
    await cloneChecklist.run(
      buildRequest({ sourceChecklistId: SOURCE_CHECKLIST_ID, title: "Checklist nuova occasione" })
    );

    expect(savedChecklistDocument()?.category).toBe("devicetype-arto-superiore");
  });

  it("overrides the category with the one provided by the consumer", async () => {
    await cloneChecklist.run(
      buildRequest({
        sourceChecklistId: SOURCE_CHECKLIST_ID,
        title: "Checklist nuova occasione",
        category: "devicetype-mano",
      })
    );

    expect(savedChecklistDocument()?.category).toBe("devicetype-mano");
  });

  it("saves the title, createdAt and the itemId references provided by the consumer", async () => {
    await cloneChecklist.run(
      buildRequest({ sourceChecklistId: SOURCE_CHECKLIST_ID, title: "Checklist nuova occasione" })
    );

    const document = savedChecklistDocument();
    expect(document?.title).toBe("Checklist nuova occasione");
    expect(document?.createdAt).toBe(SERVER_TIMESTAMP_SENTINEL);
    expect(document?.items).toEqual(savedItemDocuments().map((item) => (item as { id: string }).id));
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

    expect(savedChecklistDocument()?.createdBy).toBe("user-42");
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

    expect(getAllMock).not.toHaveBeenCalled();
    expect(savedChecklistDocument()?.items).toEqual([]);
    expect(savedItemDocuments()).toEqual([]);
  });

  it("throws not-found when the source checklist does not exist", async () => {
    await expect(
      cloneChecklist.run(
        buildRequest({ sourceChecklistId: "missing-checklist", title: "Checklist nuova occasione" })
      )
    ).rejects.toMatchObject(new HttpsError("not-found", "Source checklist not found"));

    expect(batchCommitMock).not.toHaveBeenCalled();
  });

  it("throws unauthenticated when there is no auth context", async () => {
    await expect(
      cloneChecklist.run(
        buildRequest({ sourceChecklistId: SOURCE_CHECKLIST_ID, title: "Checklist nuova occasione" }, null)
      )
    ).rejects.toMatchObject(new HttpsError("unauthenticated", "Authentication required"));

    expect(batchCommitMock).not.toHaveBeenCalled();
  });

  it("throws invalid-argument when sourceChecklistId is missing", async () => {
    await expect(
      cloneChecklist.run(buildRequest({ title: "Checklist nuova occasione" }))
    ).rejects.toMatchObject(new HttpsError("invalid-argument", "Missing or invalid sourceChecklistId"));

    expect(batchCommitMock).not.toHaveBeenCalled();
  });

  it("throws invalid-argument when title is missing", async () => {
    await expect(
      cloneChecklist.run(buildRequest({ sourceChecklistId: SOURCE_CHECKLIST_ID }))
    ).rejects.toMatchObject(new HttpsError("invalid-argument", "Missing or invalid title"));

    expect(batchCommitMock).not.toHaveBeenCalled();
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

    expect(batchCommitMock).not.toHaveBeenCalled();
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
