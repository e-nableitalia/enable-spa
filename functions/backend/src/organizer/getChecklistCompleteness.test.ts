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

jest.mock("../security/securityLog", () => ({
  logSecurityEvent: jest.fn().mockResolvedValue(undefined),
}));

import { logSecurityEvent } from "../security/securityLog";
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

  // Scenario: checklist completa quando tutti gli item soddisfano assegnatario
  // e stato "Completata" (EA-127: calcolo type-aware, item senza `type`
  // trattati come 'generic').
  it("returns complete: true when all items satisfy the completeness criteria", async () => {
    getMock.mockResolvedValue(
      buildChecklistSnapshot([
        { id: "item-1", assignee: "Mario Rossi", quantity: 2, status: "Completata" },
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
        { id: "item-1", assignee: null, quantity: 2, status: "Completata" },
      ])
    );

    const result = await getChecklistCompleteness.run(buildRequest({ checklistId: CHECKLIST_ID }));

    expect(result).toEqual({ checklistId: CHECKLIST_ID, complete: false });
  });

  // Scenario 4 (EA-127): checklist incompleta perché un item numeric con quantità
  // rilevante non l'ha valorizzata
  it("returns complete: false when a numeric item's quantity field is present but null", async () => {
    getMock.mockResolvedValue(
      buildChecklistSnapshot([
        { id: "item-1", type: "numeric", assignee: "Mario Rossi", quantity: null, status: "Completata" },
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

  // Scenario 2 (EA-127): checklist incompleta perché un item generic è ancora
  // 'Da iniziare' o 'In corso' (corregge il bug per cui qualunque stato diverso
  // da "Assegnare" risultava completo)
  it.each(["Da iniziare", "In corso"])(
    "returns complete: false when a generic item's status is '%s'",
    async (status) => {
      getMock.mockResolvedValue(
        buildChecklistSnapshot([
          { id: "item-1", type: "generic", assignee: "Mario Rossi", quantity: 2, status },
        ])
      );

      const result = await getChecklistCompleteness.run(buildRequest({ checklistId: CHECKLIST_ID }));

      expect(result).toEqual({ checklistId: CHECKLIST_ID, complete: false });
    }
  );

  // Scenario 1 (EA-127): item boolean completo indipendentemente da status e quantity
  it("returns complete: true for a boolean item with assignee set and completed=true, regardless of status/quantity", async () => {
    getMock.mockResolvedValue(
      buildChecklistSnapshot([
        { id: "item-1", type: "boolean", assignee: "Mario Rossi", status: "Assegnare", completed: true },
      ])
    );

    const result = await getChecklistCompleteness.run(buildRequest({ checklistId: CHECKLIST_ID }));

    expect(result).toEqual({ checklistId: CHECKLIST_ID, complete: true });
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

  it("logs a success security event when the completeness gate is evaluated", async () => {
    getMock.mockResolvedValue(buildChecklistSnapshot([]));

    await getChecklistCompleteness.run(buildRequest({ checklistId: CHECKLIST_ID }));

    expect(logSecurityEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "get_checklist_completeness",
        outcome: "success",
        context: expect.objectContaining({ function: "getChecklistCompleteness" }),
      })
    );
  });

  it("logs a failure security event when the checklist does not exist", async () => {
    getMock.mockResolvedValue({ exists: false, data: () => undefined });

    await expect(
      getChecklistCompleteness.run(buildRequest({ checklistId: "missing-id" }))
    ).rejects.toBeInstanceOf(HttpsError);

    expect(logSecurityEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "get_checklist_completeness_failed",
        outcome: "failure",
        context: expect.objectContaining({ function: "getChecklistCompleteness" }),
      })
    );
  });
});
