import { HttpsError } from "firebase-functions/v2/https";
import type { CallableRequest } from "firebase-functions/v2/https";

const SERVER_TIMESTAMP_SENTINEL = { __type: "serverTimestamp" };
const TEMPLATE_ID = "existing-template-id";
const GENERATED_CHECKLIST_ID = "generated-checklist-id";

/**
 * Store in-memory minimale che simula la collection `templates` da cui
 * viene letto il template sorgente (catalogo, non toccato da EA-137: gli
 * item restano un array embedded).
 */
let templatesStore: Record<string, Record<string, unknown> | undefined>;

const templateDocMock = jest.fn();
const batchSetMock = jest.fn();
const batchCommitMock = jest.fn().mockResolvedValue(undefined);

let generatedItemCounter = 0;

const checklistItemDocMock = jest.fn(() => {
  generatedItemCounter += 1;
  return { id: `generated-item-id-${generatedItemCounter}` };
});

function buildCollection(name: string) {
  if (name === "templates") {
    return { doc: templateDocMock };
  }
  if (name === "checklists") {
    return { doc: jest.fn(() => ({ id: GENERATED_CHECKLIST_ID })) };
  }
  return { doc: checklistItemDocMock };
}

const collectionMock = jest.fn((name: string) => buildCollection(name));

jest.mock("firebase-admin/firestore", () => ({
  getFirestore: jest.fn(() => ({
    collection: (name: string) => collectionMock(name),
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
import { createChecklistFromTemplate } from "./createChecklistFromTemplate";

function buildRequest(data: Record<string, unknown>, uid: string | null = "user-1"): CallableRequest {
  return {
    auth: uid ? ({ uid } as CallableRequest["auth"]) : undefined,
    data,
    rawRequest: { headers: {} } as CallableRequest["rawRequest"],
  } as CallableRequest;
}

describe("createChecklistFromTemplate", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    generatedItemCounter = 0;
    batchCommitMock.mockResolvedValue(undefined);

    templatesStore = {
      [TEMPLATE_ID]: {
        category: "devicetype-arto-superiore",
        title: "Checklist stampa standard",
        items: [
          { title: "Prepara stampante", type: "boolean", quantity: 2 },
          { title: "Verifica materiale", type: "numeric", quantity: null },
        ],
      },
    };

    templateDocMock.mockImplementation((id: string) => ({
      get: jest.fn(() => {
        const data = templatesStore[id];
        return Promise.resolve({ exists: data !== undefined, data: () => data });
      }),
    }));
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

  // Scenario: createChecklistFromTemplate crea checklistItems azzerati con category denormalizzata
  it("creates a checklistItems document per template item, category denormalized, status/assignee/completed/dates zeroed", async () => {
    await createChecklistFromTemplate.run(
      buildRequest({ templateId: TEMPLATE_ID, title: "Checklist evento" })
    );

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
  });

  // Scenario: createChecklistFromTemplate crea checklistItems azzerati con category denormalizzata
  it("denormalizes the new checklist's category (overridden by the consumer) onto every created checklistItems document", async () => {
    await createChecklistFromTemplate.run(
      buildRequest({ templateId: TEMPLATE_ID, title: "Checklist evento", category: "devicetype-mano" })
    );

    for (const item of savedItemDocuments()) {
      expect((item as { category: string }).category).toBe("devicetype-mano");
    }
  });

  it("propagates the type of each template item onto the created instance item (regression, EA-126)", async () => {
    templatesStore[TEMPLATE_ID] = {
      category: "devicetype-arto-superiore",
      title: "Checklist stampa standard",
      items: [
        { title: "Item booleano", type: "boolean", quantity: null },
        { title: "Item generico", type: "generic", quantity: null },
        { title: "Item numerico", type: "numeric", quantity: 3 },
      ],
    };

    await createChecklistFromTemplate.run(
      buildRequest({ templateId: TEMPLATE_ID, title: "Checklist evento" })
    );

    const items = savedItemDocuments();
    expect(items.map((item) => (item as { type: string }).type)).toEqual([
      "boolean",
      "generic",
      "numeric",
    ]);
    for (const item of items) {
      const typedItem = item as Record<string, unknown>;
      expect(typedItem.status).toBe("Assegnare");
      expect(typedItem.assignee).toBeNull();
      expect(typedItem.completed).toBe(false);
      expect(typedItem.creationDate).toBeNull();
      expect(typedItem.dueDate).toBeNull();
      expect(typedItem.completionDate).toBeNull();
    }
  });

  it("defaults type to 'generic' when a legacy template item has no type (pre-EA-125 data)", async () => {
    templatesStore[TEMPLATE_ID] = {
      category: "devicetype-arto-superiore",
      title: "Checklist legacy",
      items: [{ title: "Item legacy senza type", quantity: null }],
    };

    await createChecklistFromTemplate.run(
      buildRequest({ templateId: TEMPLATE_ID, title: "Checklist evento" })
    );

    expect((savedItemDocuments()[0] as { type: string }).type).toBe("generic");
  });

  // Scenario: createChecklistFromTemplate crea checklistItems azzerati con category denormalizzata
  it("registers fromTemplate as a historical reference to the source template", async () => {
    await createChecklistFromTemplate.run(
      buildRequest({ templateId: TEMPLATE_ID, title: "Checklist evento" })
    );

    expect(savedChecklistDocument()?.fromTemplate).toBe(TEMPLATE_ID);
  });

  // Scenario: createChecklistFromTemplate salva origin quando fornito, lo omette quando assente
  // (regressione: bug segnalato dall'operatore, "To Do List" senza Note/Stato editabili
  // ne' Provenienza navigabile — createDeviceRequestChecklist non passava mai origin
  // a questo endpoint, l'unico percorso di creazione reale per checklist da template).
  it("writes the origin field with the exact value provided by the consumer", async () => {
    await createChecklistFromTemplate.run(
      buildRequest({
        templateId: TEMPLATE_ID,
        title: "Checklist evento",
        origin: { type: "deviceRequest", id: "request-42" },
      })
    );

    expect(savedChecklistDocument()?.origin).toEqual({ type: "deviceRequest", id: "request-42" });
  });

  it("does not write an origin field when origin is not provided", async () => {
    await createChecklistFromTemplate.run(
      buildRequest({ templateId: TEMPLATE_ID, title: "Checklist evento" })
    );

    expect(savedChecklistDocument()).not.toHaveProperty("origin");
  });

  it("throws invalid-argument when origin is provided but malformed", async () => {
    await expect(
      createChecklistFromTemplate.run(
        buildRequest({
          templateId: TEMPLATE_ID,
          title: "Checklist evento",
          origin: { type: "deviceRequest" },
        })
      )
    ).rejects.toMatchObject(new HttpsError("invalid-argument", "origin must be an object with type and id"));
  });

  it("inherits the category from the template when not overridden by the consumer", async () => {
    await createChecklistFromTemplate.run(
      buildRequest({ templateId: TEMPLATE_ID, title: "Checklist evento" })
    );

    expect(savedChecklistDocument()?.category).toBe("devicetype-arto-superiore");
  });

  it("overrides the category with the one provided by the consumer", async () => {
    await createChecklistFromTemplate.run(
      buildRequest({ templateId: TEMPLATE_ID, title: "Checklist evento", category: "devicetype-mano" })
    );

    expect(savedChecklistDocument()?.category).toBe("devicetype-mano");
  });

  it("saves the title, createdAt and the itemId references provided by the consumer", async () => {
    await createChecklistFromTemplate.run(
      buildRequest({ templateId: TEMPLATE_ID, title: "Checklist evento" })
    );

    const document = savedChecklistDocument();
    expect(document?.title).toBe("Checklist evento");
    expect(document?.createdAt).toBe(SERVER_TIMESTAMP_SENTINEL);
    expect(document?.items).toEqual(savedItemDocuments().map((item) => (item as { id: string }).id));
  });

  it("returns the generated checklistId to the consumer", async () => {
    const result = await createChecklistFromTemplate.run(
      buildRequest({ templateId: TEMPLATE_ID, title: "Checklist evento" })
    );

    expect(result).toEqual({ checklistId: GENERATED_CHECKLIST_ID });
  });

  it("writes createdBy with the authenticated caller's uid", async () => {
    await createChecklistFromTemplate.run(
      buildRequest({ templateId: TEMPLATE_ID, title: "Checklist evento" }, "user-42")
    );

    expect(savedChecklistDocument()?.createdBy).toBe("user-42");
  });

  it("creates an instance with no items when the template has none", async () => {
    templatesStore[TEMPLATE_ID] = {
      category: "devicetype-arto-superiore",
      title: "Checklist vuota",
      items: [],
    };

    await createChecklistFromTemplate.run(
      buildRequest({ templateId: TEMPLATE_ID, title: "Checklist evento" })
    );

    expect(savedChecklistDocument()?.items).toEqual([]);
    expect(savedItemDocuments()).toEqual([]);
  });

  it("throws not-found when the template does not exist", async () => {
    await expect(
      createChecklistFromTemplate.run(
        buildRequest({ templateId: "missing-template", title: "Checklist evento" })
      )
    ).rejects.toMatchObject(new HttpsError("not-found", "Template not found"));

    expect(batchCommitMock).not.toHaveBeenCalled();
  });

  it("throws unauthenticated when there is no auth context", async () => {
    await expect(
      createChecklistFromTemplate.run(
        buildRequest({ templateId: TEMPLATE_ID, title: "Checklist evento" }, null)
      )
    ).rejects.toMatchObject(new HttpsError("unauthenticated", "Authentication required"));

    expect(batchCommitMock).not.toHaveBeenCalled();
  });

  it("throws invalid-argument when templateId is missing", async () => {
    await expect(
      createChecklistFromTemplate.run(buildRequest({ title: "Checklist evento" }))
    ).rejects.toMatchObject(new HttpsError("invalid-argument", "Missing or invalid templateId"));

    expect(batchCommitMock).not.toHaveBeenCalled();
  });

  it("throws invalid-argument when title is missing", async () => {
    await expect(
      createChecklistFromTemplate.run(buildRequest({ templateId: TEMPLATE_ID }))
    ).rejects.toMatchObject(new HttpsError("invalid-argument", "Missing or invalid title"));

    expect(batchCommitMock).not.toHaveBeenCalled();
  });

  it("throws invalid-argument when category is not a string", async () => {
    await expect(
      createChecklistFromTemplate.run(
        buildRequest({ templateId: TEMPLATE_ID, title: "Checklist evento", category: 123 })
      )
    ).rejects.toMatchObject(new HttpsError("invalid-argument", "category must be a string"));

    expect(batchCommitMock).not.toHaveBeenCalled();
  });

  it("logs a success security event when the checklist is created from a template", async () => {
    await createChecklistFromTemplate.run(
      buildRequest({ templateId: TEMPLATE_ID, title: "Checklist evento" })
    );

    expect(logSecurityEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "create_checklist_from_template",
        outcome: "success",
        context: expect.objectContaining({ function: "createChecklistFromTemplate" }),
      })
    );
  });

  it("logs a failure security event when the source template does not exist", async () => {
    await expect(
      createChecklistFromTemplate.run(
        buildRequest({ templateId: "missing-template", title: "Checklist evento" })
      )
    ).rejects.toBeInstanceOf(HttpsError);

    expect(logSecurityEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "create_checklist_from_template_failed",
        outcome: "failure",
        context: expect.objectContaining({ function: "createChecklistFromTemplate" }),
      })
    );
  });
});
