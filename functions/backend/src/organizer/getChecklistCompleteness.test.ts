import { HttpsError } from "firebase-functions/v2/https";
import type { CallableRequest } from "firebase-functions/v2/https";

const CHECKLIST_ID = "existing-checklist-id";

const getMock = jest.fn();
const updateMock = jest.fn();
const setMock = jest.fn();
const docMock = jest.fn();
const collectionMock = jest.fn();
const getAllMock = jest.fn();

jest.mock("firebase-admin/firestore", () => ({
  getFirestore: jest.fn(() => ({
    collection: collectionMock,
    getAll: getAllMock,
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

function buildChecklistSnapshot(itemIds: string[]) {
  return {
    exists: true,
    data: () => ({
      category: "devicetype-arto-superiore",
      title: "Checklist evento",
      items: itemIds,
    }),
  };
}

function buildItemSnap(id: string, data: Record<string, unknown>) {
  return { id, exists: true, data: () => data };
}

/** Configura `getAllMock` per risolvere ogni itemId nell'item corrispondente della mappa data. */
function stubResolvedItems(items: Record<string, Record<string, unknown>>) {
  getAllMock.mockImplementation((...refs: { id: string }[]) =>
    Promise.resolve(refs.map((ref) => buildItemSnap(ref.id, items[ref.id])))
  );
}

describe("getChecklistCompleteness", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    docMock.mockImplementation((id: string) => ({ id, get: getMock, update: updateMock, set: setMock }));
    collectionMock.mockReturnValue({ doc: docMock });
  });

  // Scenario: getChecklistCompleteness applica il gate sugli item risolti da checklistItems
  it("returns complete: true when all resolved items satisfy the completeness criteria", async () => {
    getMock.mockResolvedValue(buildChecklistSnapshot(["item-1", "item-2"]));
    stubResolvedItems({
      "item-1": { id: "item-1", assignee: "Mario Rossi", quantity: 2, status: "Completata" },
      "item-2": { id: "item-2", assignee: "Luigi Bianchi", status: "Completata" },
    });

    const result = await getChecklistCompleteness.run(buildRequest({ checklistId: CHECKLIST_ID }));

    expect(collectionMock).toHaveBeenCalledWith("checklists");
    expect(collectionMock).toHaveBeenCalledWith("checklistItems");
    expect(docMock).toHaveBeenCalledWith(CHECKLIST_ID);
    expect(getAllMock).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ checklistId: CHECKLIST_ID, complete: true });
  });

  // Scenario: getChecklistCompleteness applica il gate sugli item risolti da checklistItems
  it("returns complete: false when at least one resolved item has no assignee", async () => {
    getMock.mockResolvedValue(buildChecklistSnapshot(["item-1"]));
    stubResolvedItems({
      "item-1": { id: "item-1", assignee: null, quantity: 2, status: "Completata" },
    });

    const result = await getChecklistCompleteness.run(buildRequest({ checklistId: CHECKLIST_ID }));

    expect(result).toEqual({ checklistId: CHECKLIST_ID, complete: false });
  });

  it("returns complete: false when a resolved numeric item's quantity field is present but null", async () => {
    getMock.mockResolvedValue(buildChecklistSnapshot(["item-1"]));
    stubResolvedItems({
      "item-1": { id: "item-1", type: "numeric", assignee: "Mario Rossi", quantity: null, status: "Completata" },
    });

    const result = await getChecklistCompleteness.run(buildRequest({ checklistId: CHECKLIST_ID }));

    expect(result).toEqual({ checklistId: CHECKLIST_ID, complete: false });
  });

  it("returns complete: false when a resolved item's status is still 'Assegnare'", async () => {
    getMock.mockResolvedValue(buildChecklistSnapshot(["item-1"]));
    stubResolvedItems({
      "item-1": { id: "item-1", assignee: "Mario Rossi", quantity: 2, status: "Assegnare" },
    });

    const result = await getChecklistCompleteness.run(buildRequest({ checklistId: CHECKLIST_ID }));

    expect(result).toEqual({ checklistId: CHECKLIST_ID, complete: false });
  });

  it.each(["Da iniziare", "In corso"])(
    "returns complete: false when a resolved generic item's status is '%s'",
    async (status) => {
      getMock.mockResolvedValue(buildChecklistSnapshot(["item-1"]));
      stubResolvedItems({
        "item-1": { id: "item-1", type: "generic", assignee: "Mario Rossi", quantity: 2, status },
      });

      const result = await getChecklistCompleteness.run(buildRequest({ checklistId: CHECKLIST_ID }));

      expect(result).toEqual({ checklistId: CHECKLIST_ID, complete: false });
    }
  );

  it("returns complete: true for a resolved boolean item with assignee set and completed=true, regardless of status/quantity", async () => {
    getMock.mockResolvedValue(buildChecklistSnapshot(["item-1"]));
    stubResolvedItems({
      "item-1": { id: "item-1", type: "boolean", assignee: "Mario Rossi", status: "Assegnare", completed: true },
    });

    const result = await getChecklistCompleteness.run(buildRequest({ checklistId: CHECKLIST_ID }));

    expect(result).toEqual({ checklistId: CHECKLIST_ID, complete: true });
  });

  // Scenario: checklist senza item è considerata completa, senza bisogno di risolvere alcun documento
  it("returns complete: true when the checklist has no items, without calling db.getAll", async () => {
    getMock.mockResolvedValue(buildChecklistSnapshot([]));

    const result = await getChecklistCompleteness.run(buildRequest({ checklistId: CHECKLIST_ID }));

    expect(getAllMock).not.toHaveBeenCalled();
    expect(result).toEqual({ checklistId: CHECKLIST_ID, complete: true });
  });

  // Scenario: getChecklistCompleteness funziona correttamente anche oltre il limite di 30 item (stesso meccanismo di getChecklist)
  it("resolves more than 30 referenced items via a single db.getAll batch read", async () => {
    const manyItemIds = Array.from({ length: 40 }, (_, i) => `item-${i + 1}`);
    getMock.mockResolvedValue(buildChecklistSnapshot(manyItemIds));
    getAllMock.mockImplementation((...refs: { id: string }[]) =>
      Promise.resolve(
        refs.map((ref) =>
          buildItemSnap(ref.id, { id: ref.id, assignee: "Mario Rossi", quantity: 1, status: "Completata" })
        )
      )
    );

    const result = await getChecklistCompleteness.run(buildRequest({ checklistId: CHECKLIST_ID }));

    expect(getAllMock).toHaveBeenCalledTimes(1);
    expect(getAllMock.mock.calls[0]).toHaveLength(40);
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
  it("does not write to the checklist or item documents (read-only gate)", async () => {
    getMock.mockResolvedValue(buildChecklistSnapshot(["item-1"]));
    stubResolvedItems({
      "item-1": { id: "item-1", assignee: "Mario Rossi", quantity: 2, status: "In corso" },
    });

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
