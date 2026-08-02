import { HttpsError } from "firebase-functions/v2/https";
import type { CallableRequest } from "firebase-functions/v2/https";

const SERVER_TIMESTAMP_SENTINEL = { __type: "serverTimestamp" };
const TEMPLATE_ID = "existing-template-id";
const GENERATED_CHECKLIST_ID = "generated-checklist-id";

/**
 * Store in-memory minimale che simula la collection `templates` da cui
 * viene letto il template sorgente della clonazione.
 */
let templatesStore: Record<string, Record<string, unknown> | undefined>;

const setMock = jest.fn().mockResolvedValue(undefined);
const checklistDocMock = jest.fn(() => ({ id: GENERATED_CHECKLIST_ID, set: setMock }));

function buildCollection(name: string) {
  if (name === "templates") {
    return {
      doc: jest.fn((id: string) => ({
        get: jest.fn(() => {
          const data = templatesStore[id];
          return Promise.resolve({
            exists: data !== undefined,
            data: () => data,
          });
        }),
      })),
    };
  }

  return {
    doc: checklistDocMock,
  };
}

const collectionMock = jest.fn((name: string) => buildCollection(name));

jest.mock("firebase-admin/firestore", () => ({
  getFirestore: jest.fn(() => ({
    collection: (name: string) => collectionMock(name),
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
    setMock.mockResolvedValue(undefined);

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
  });

  it("clones template items into the new instance resetting status, assignee and completed", async () => {
    await createChecklistFromTemplate.run(
      buildRequest({ templateId: TEMPLATE_ID, title: "Checklist evento" })
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

    // ogni item clonato ha un id univoco generato per la nuova istanza.
    const ids = savedDocument.items.map((item: { id: string }) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("propagates the type of each template item onto the cloned instance item (Scenario 1)", async () => {
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

    const [savedDocument] = setMock.mock.calls[0];
    expect(savedDocument.items.map((item: { type: string }) => item.type)).toEqual([
      "boolean",
      "generic",
      "numeric",
    ]);
    // status/assignee/completed restano ai valori iniziali di una nuova istanza,
    // indipendentemente dal type propagato.
    for (const item of savedDocument.items) {
      expect(item.status).toBe("Assegnare");
      expect(item.assignee).toBeNull();
      expect(item.completed).toBe(false);
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

    const [savedDocument] = setMock.mock.calls[0];
    expect(savedDocument.items[0].type).toBe("generic");
  });

  it("registers fromTemplate as a historical reference to the source template", async () => {
    await createChecklistFromTemplate.run(
      buildRequest({ templateId: TEMPLATE_ID, title: "Checklist evento" })
    );

    const [savedDocument] = setMock.mock.calls[0];
    expect(savedDocument.fromTemplate).toBe(TEMPLATE_ID);
  });

  it("inherits the category from the template when not overridden by the consumer", async () => {
    await createChecklistFromTemplate.run(
      buildRequest({ templateId: TEMPLATE_ID, title: "Checklist evento" })
    );

    const [savedDocument] = setMock.mock.calls[0];
    expect(savedDocument.category).toBe("devicetype-arto-superiore");
  });

  it("overrides the category with the one provided by the consumer", async () => {
    await createChecklistFromTemplate.run(
      buildRequest({ templateId: TEMPLATE_ID, title: "Checklist evento", category: "devicetype-mano" })
    );

    const [savedDocument] = setMock.mock.calls[0];
    expect(savedDocument.category).toBe("devicetype-mano");
  });

  it("saves the title and createdAt provided by the consumer", async () => {
    await createChecklistFromTemplate.run(
      buildRequest({ templateId: TEMPLATE_ID, title: "Checklist evento" })
    );

    const [savedDocument] = setMock.mock.calls[0];
    expect(savedDocument.title).toBe("Checklist evento");
    expect(savedDocument.createdAt).toBe(SERVER_TIMESTAMP_SENTINEL);
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

    const [savedDocument] = setMock.mock.calls[0];
    expect(savedDocument.createdBy).toBe("user-42");
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

    const [savedDocument] = setMock.mock.calls[0];
    expect(savedDocument.items).toEqual([]);
  });

  it("throws not-found when the template does not exist", async () => {
    await expect(
      createChecklistFromTemplate.run(
        buildRequest({ templateId: "missing-template", title: "Checklist evento" })
      )
    ).rejects.toMatchObject(new HttpsError("not-found", "Template not found"));

    expect(setMock).not.toHaveBeenCalled();
  });

  it("throws unauthenticated when there is no auth context", async () => {
    await expect(
      createChecklistFromTemplate.run(
        buildRequest({ templateId: TEMPLATE_ID, title: "Checklist evento" }, null)
      )
    ).rejects.toMatchObject(new HttpsError("unauthenticated", "Authentication required"));

    expect(setMock).not.toHaveBeenCalled();
  });

  it("throws invalid-argument when templateId is missing", async () => {
    await expect(
      createChecklistFromTemplate.run(buildRequest({ title: "Checklist evento" }))
    ).rejects.toMatchObject(new HttpsError("invalid-argument", "Missing or invalid templateId"));

    expect(setMock).not.toHaveBeenCalled();
  });

  it("throws invalid-argument when title is missing", async () => {
    await expect(
      createChecklistFromTemplate.run(buildRequest({ templateId: TEMPLATE_ID }))
    ).rejects.toMatchObject(new HttpsError("invalid-argument", "Missing or invalid title"));

    expect(setMock).not.toHaveBeenCalled();
  });

  it("throws invalid-argument when category is not a string", async () => {
    await expect(
      createChecklistFromTemplate.run(
        buildRequest({ templateId: TEMPLATE_ID, title: "Checklist evento", category: 123 })
      )
    ).rejects.toMatchObject(new HttpsError("invalid-argument", "category must be a string"));

    expect(setMock).not.toHaveBeenCalled();
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
