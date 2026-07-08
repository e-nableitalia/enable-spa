import { HttpsError } from "firebase-functions/v2/https";
import type { CallableRequest } from "firebase-functions/v2/https";

const CHECKLIST_ID = "existing-checklist-id";

const getMock = jest.fn();
const updateMock = jest.fn();
const setMock = jest.fn();
const docMock = jest.fn();
const collectionMock = jest.fn();

jest.mock("firebase-admin/firestore", () => ({
  getFirestore: jest.fn(() => ({
    collection: collectionMock,
  })),
}));

import { getChecklistCompleteness } from "./getChecklistCompleteness";

function buildRequest(data: Record<string, unknown>, uid: string | null = "user-1"): CallableRequest {
  return {
    auth: uid ? ({ uid } as CallableRequest["auth"]) : undefined,
    data,
    rawRequest: { headers: {} } as CallableRequest["rawRequest"],
  } as CallableRequest;
}

function buildChecklistSnapshot(items: unknown[]) {
  return {
    exists: true,
    data: () => ({
      category: "devicetype-arto-superiore",
      title: "Checklist evento",
      items,
    }),
  };
}

describe("getChecklistCompleteness", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    docMock.mockReturnValue({ get: getMock, update: updateMock, set: setMock });
    collectionMock.mockReturnValue({ doc: docMock });
  });

  // Scenario: checklist completa quando tutti gli item soddisfano assegnatario,
  // quantità (se rilevante) e stato diverso da "Assegnare".
  it("returns complete: true when all items satisfy the completeness criteria", async () => {
    getMock.mockResolvedValue(
      buildChecklistSnapshot([
        { id: "item-1", assignee: "Mario Rossi", quantity: 2, status: "In corso" },
        { id: "item-2", assignee: "Luigi Bianchi", status: "Completata" },
      ])
    );

    const result = await getChecklistCompleteness.run(buildRequest({ checklistId: CHECKLIST_ID }));

    expect(collectionMock).toHaveBeenCalledWith("checklists");
    expect(docMock).toHaveBeenCalledWith(CHECKLIST_ID);
    expect(result).toEqual({ checklistId: CHECKLIST_ID, complete: true });
  });

  // Scenario: checklist incompleta perché un item non ha l'assegnatario valorizzato
  it("returns complete: false when at least one item has no assignee", async () => {
    getMock.mockResolvedValue(
      buildChecklistSnapshot([
        { id: "item-1", assignee: null, quantity: 2, status: "In corso" },
      ])
    );

    const result = await getChecklistCompleteness.run(buildRequest({ checklistId: CHECKLIST_ID }));

    expect(result).toEqual({ checklistId: CHECKLIST_ID, complete: false });
  });

  // Scenario: checklist incompleta perché un item con campo quantità rilevante
  // non lo ha valorizzato
  it("returns complete: false when an item's quantity field is present but null", async () => {
    getMock.mockResolvedValue(
      buildChecklistSnapshot([
        { id: "item-1", assignee: "Mario Rossi", quantity: null, status: "In corso" },
      ])
    );

    const result = await getChecklistCompleteness.run(buildRequest({ checklistId: CHECKLIST_ID }));

    expect(result).toEqual({ checklistId: CHECKLIST_ID, complete: false });
  });

  // Scenario: checklist incompleta perché un item è ancora nello stato iniziale "Assegnare"
  it("returns complete: false when an item's status is still 'Assegnare'", async () => {
    getMock.mockResolvedValue(
      buildChecklistSnapshot([
        { id: "item-1", assignee: "Mario Rossi", quantity: 2, status: "Assegnare" },
      ])
    );

    const result = await getChecklistCompleteness.run(buildRequest({ checklistId: CHECKLIST_ID }));

    expect(result).toEqual({ checklistId: CHECKLIST_ID, complete: false });
  });

  // Scenario: checklist senza item è considerata completa
  it("returns complete: true when the checklist has no items", async () => {
    getMock.mockResolvedValue(buildChecklistSnapshot([]));

    const result = await getChecklistCompleteness.run(buildRequest({ checklistId: CHECKLIST_ID }));

    expect(result).toEqual({ checklistId: CHECKLIST_ID, complete: true });
  });

  it("throws unauthenticated when there is no auth context", async () => {
    await expect(
      getChecklistCompleteness.run(buildRequest({ checklistId: CHECKLIST_ID }, null))
    ).rejects.toMatchObject(new HttpsError("unauthenticated", "User must be authenticated"));

    expect(getMock).not.toHaveBeenCalled();
  });

  it("throws invalid-argument when checklistId is missing", async () => {
    await expect(getChecklistCompleteness.run(buildRequest({}))).rejects.toMatchObject(
      new HttpsError("invalid-argument", "Missing parameter: checklistId")
    );

    expect(getMock).not.toHaveBeenCalled();
  });

  it("throws not-found when the checklist does not exist", async () => {
    getMock.mockResolvedValue({ exists: false, data: () => undefined });

    await expect(
      getChecklistCompleteness.run(buildRequest({ checklistId: "missing-id" }))
    ).rejects.toMatchObject(new HttpsError("not-found", "Checklist not found"));
  });

  // Contratto architetturale: il gate non modifica il documento.
  it("does not write to the checklist document (read-only gate)", async () => {
    getMock.mockResolvedValue(
      buildChecklistSnapshot([
        { id: "item-1", assignee: "Mario Rossi", quantity: 2, status: "In corso" },
      ])
    );

    await getChecklistCompleteness.run(buildRequest({ checklistId: CHECKLIST_ID }));

    expect(updateMock).not.toHaveBeenCalled();
    expect(setMock).not.toHaveBeenCalled();
  });
});
