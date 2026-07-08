import { HttpsError } from "firebase-functions/v2/https";
import type { CallableRequest } from "firebase-functions/v2/https";

const TEMPLATE_ID = "existing-template-id";
const CHECKLIST_ID = "checklist-from-template";

/**
 * Store in-memory minimale che simula le collection Firestore coinvolte:
 * `templates` (il documento da eliminare) e `checklists` (un'istanza già
 * creata a partire da quel template, che referenzia `fromTemplate:
 * templateId`). Serve a verificare che deleteTemplate tocchi solo il
 * documento template e lasci invariata l'istanza checklist collegata.
 */
let templatesStore: Record<string, Record<string, unknown> | undefined>;
let checklistsStore: Record<string, Record<string, unknown> | undefined>;

const templatesDeleteMock = jest.fn((id: string) => {
  delete templatesStore[id];
  return Promise.resolve();
});

function buildCollection(name: string) {
  return {
    doc: jest.fn((id: string) => ({
      get: jest.fn(() => {
        const store = name === "templates" ? templatesStore : checklistsStore;
        const data = store[id];
        return Promise.resolve({
          exists: data !== undefined,
          data: () => data,
        });
      }),
      delete: jest.fn(() => {
        if (name === "templates") {
          return templatesDeleteMock(id);
        }
        return Promise.resolve();
      }),
    })),
  };
}

const collectionMock = jest.fn((name: string) => buildCollection(name));

jest.mock("firebase-admin/firestore", () => ({
  getFirestore: jest.fn(() => ({
    collection: (name: string) => collectionMock(name),
  })),
}));

import { deleteTemplate } from "./deleteTemplate";

function buildRequest(data: Record<string, unknown>, uid: string | null = "user-1"): CallableRequest {
  return {
    auth: uid ? ({ uid } as CallableRequest["auth"]) : undefined,
    data,
    rawRequest: { headers: {} } as CallableRequest["rawRequest"],
  } as CallableRequest;
}

describe("deleteTemplate", () => {
  beforeEach(() => {
    jest.clearAllMocks();

    templatesStore = {
      [TEMPLATE_ID]: {
        category: "devicetype-arto-superiore",
        title: "Checklist stampa",
        items: [{ title: "Prepara stampante", quantity: 2 }],
      },
    };

    checklistsStore = {
      [CHECKLIST_ID]: {
        category: "devicetype-arto-superiore",
        title: "Checklist evento",
        fromTemplate: TEMPLATE_ID,
        items: [],
      },
    };
  });

  it("deletes the templates/{templateId} document from Firestore", async () => {
    const result = await deleteTemplate.run(buildRequest({ templateId: TEMPLATE_ID }));

    expect(collectionMock).toHaveBeenCalledWith("templates");
    expect(templatesStore[TEMPLATE_ID]).toBeUndefined();
    expect(result).toEqual({ templateId: TEMPLATE_ID });
  });

  it("does not modify checklist instances referencing the deleted template via fromTemplate", async () => {
    await deleteTemplate.run(buildRequest({ templateId: TEMPLATE_ID }));

    // Il template è stato eliminato...
    expect(templatesStore[TEMPLATE_ID]).toBeUndefined();

    // ...ma la checklist creata da quel template resta intatta, con il
    // riferimento fromTemplate invariato: è un dato storico, non viene
    // ricalcolato né rimosso.
    const checklistSnap = await checklistsStore[CHECKLIST_ID];
    expect(checklistSnap).toEqual({
      category: "devicetype-arto-superiore",
      title: "Checklist evento",
      fromTemplate: TEMPLATE_ID,
      items: [],
    });
  });

  it("throws not-found and does not call delete when the template does not exist", async () => {
    delete templatesStore[TEMPLATE_ID];

    await expect(
      deleteTemplate.run(buildRequest({ templateId: TEMPLATE_ID }))
    ).rejects.toMatchObject(new HttpsError("not-found", "Template not found"));

    expect(templatesDeleteMock).not.toHaveBeenCalled();
  });

  it("throws unauthenticated when there is no auth context", async () => {
    await expect(
      deleteTemplate.run(buildRequest({ templateId: TEMPLATE_ID }, null))
    ).rejects.toMatchObject(new HttpsError("unauthenticated", "Authentication required"));

    expect(templatesDeleteMock).not.toHaveBeenCalled();
  });

  it("throws invalid-argument when templateId is missing", async () => {
    await expect(deleteTemplate.run(buildRequest({}))).rejects.toMatchObject(
      new HttpsError("invalid-argument", "Missing or invalid templateId")
    );

    expect(templatesDeleteMock).not.toHaveBeenCalled();
  });
});
