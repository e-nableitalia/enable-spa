import { HttpsError } from "firebase-functions/v2/https";
import type { CallableRequest } from "firebase-functions/v2/https";

const CHECKLIST_ID = "existing-checklist-id";

const getMock = jest.fn();
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
import { getChecklist } from "./getChecklist";

function buildRequest(data: Record<string, unknown>, uid: string | null = "user-1"): CallableRequest {
  return {
    auth: uid ? ({ uid } as CallableRequest["auth"]) : undefined,
    data,
    rawRequest: { headers: {} } as CallableRequest["rawRequest"],
  } as CallableRequest;
}

function buildItemSnap(id: string, data: Record<string, unknown>) {
  return { id, exists: true, data: () => data };
}

describe("getChecklist", () => {
  const resolvedItems = [
    {
      id: "item-1",
      checklistId: CHECKLIST_ID,
      category: "devicetype-arto-superiore",
      title: "Prepara stampante",
      type: "generic",
      assignee: null,
      quantity: 2,
      notes: "",
      status: "Assegnare",
      completed: false,
      creationDate: { seconds: 1, nanoseconds: 0 },
      dueDate: null,
      completionDate: null,
    },
    {
      id: "item-2",
      checklistId: CHECKLIST_ID,
      category: "devicetype-arto-superiore",
      title: "Verifica materiale",
      type: "generic",
      assignee: null,
      quantity: null,
      notes: "",
      status: "Assegnare",
      completed: false,
      creationDate: { seconds: 1, nanoseconds: 0 },
      dueDate: null,
      completionDate: null,
    },
  ];

  const storedChecklist = {
    category: "devicetype-arto-superiore",
    title: "Checklist evento",
    items: resolvedItems.map((item) => item.id),
    createdAt: { seconds: 1, nanoseconds: 0 },
    updatedAt: { seconds: 2, nanoseconds: 0 },
  };

  const resolvedItemsById = new Map(resolvedItems.map((item) => [item.id, item]));

  beforeEach(() => {
    jest.clearAllMocks();
    getMock.mockResolvedValue({ exists: true, data: () => storedChecklist });
    docMock.mockImplementation((id: string) => ({ id, get: getMock }));
    collectionMock.mockReturnValue({ doc: docMock });
    getAllMock.mockImplementation((...refs: { id: string }[]) =>
      Promise.resolve(
        refs.map((ref) => buildItemSnap(ref.id, resolvedItemsById.get(ref.id) as Record<string, unknown>))
      )
    );
  });

  // Scenario: getChecklist ricostruisce items risolvendo i riferimenti per una checklist sotto i 30 item
  it("resolves each referenced itemId into the full item object read from checklistItems", async () => {
    const result = await getChecklist.run(buildRequest({ checklistId: CHECKLIST_ID }));

    expect(collectionMock).toHaveBeenCalledWith("checklists");
    expect(collectionMock).toHaveBeenCalledWith("checklistItems");
    expect(docMock).toHaveBeenCalledWith(CHECKLIST_ID);
    expect(getMock).toHaveBeenCalledTimes(1);
    expect(getAllMock).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      category: storedChecklist.category,
      title: storedChecklist.title,
      items: resolvedItems,
      createdAt: storedChecklist.createdAt,
      updatedAt: storedChecklist.updatedAt,
    });
  });

  // Scenario: getChecklist funziona correttamente anche oltre il limite di 30 item
  it("resolves all items via a single db.getAll batch read when the checklist references more than 30 itemIds", async () => {
    const manyItemIds = Array.from({ length: 45 }, (_, i) => `item-${i + 1}`);
    getMock.mockResolvedValue({
      exists: true,
      data: () => ({ ...storedChecklist, items: manyItemIds }),
    });
    getAllMock.mockImplementation((...refs: { id: string }[]) =>
      Promise.resolve(refs.map((ref) => buildItemSnap(ref.id, { id: ref.id, title: ref.id, status: "Assegnare" })))
    );

    const result = await getChecklist.run(buildRequest({ checklistId: CHECKLIST_ID }));

    expect(getAllMock).toHaveBeenCalledTimes(1);
    expect(getAllMock.mock.calls[0]).toHaveLength(45);
    expect((result as { items: unknown[] }).items).toHaveLength(45);
  });

  it("returns an empty items array without calling db.getAll when the checklist has no items", async () => {
    getMock.mockResolvedValue({ exists: true, data: () => ({ ...storedChecklist, items: [] }) });

    const result = await getChecklist.run(buildRequest({ checklistId: CHECKLIST_ID }));

    expect(getAllMock).not.toHaveBeenCalled();
    expect((result as { items: unknown[] }).items).toEqual([]);
  });

  it("throws not-found when the checklist does not exist", async () => {
    getMock.mockResolvedValue({ exists: false, data: () => undefined });

    await expect(
      getChecklist.run(buildRequest({ checklistId: "missing-id" }))
    ).rejects.toMatchObject(new HttpsError("not-found", "Checklist not found"));
  });

  it("throws unauthenticated when there is no auth context", async () => {
    await expect(
      getChecklist.run(buildRequest({ checklistId: CHECKLIST_ID }, null))
    ).rejects.toMatchObject(new HttpsError("unauthenticated", "User must be authenticated"));

    expect(getMock).not.toHaveBeenCalled();
  });

  it("throws invalid-argument when checklistId is missing", async () => {
    await expect(getChecklist.run(buildRequest({}))).rejects.toMatchObject(
      new HttpsError("invalid-argument", "Missing parameter: checklistId")
    );

    expect(getMock).not.toHaveBeenCalled();
  });

  it("logs a success security event when the checklist is read", async () => {
    await getChecklist.run(buildRequest({ checklistId: CHECKLIST_ID }));

    expect(logSecurityEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "get_checklist",
        outcome: "success",
        context: expect.objectContaining({ function: "getChecklist" }),
      })
    );
  });

  it("logs a failure security event when the checklist does not exist", async () => {
    getMock.mockResolvedValue({ exists: false, data: () => undefined });

    await expect(
      getChecklist.run(buildRequest({ checklistId: "missing-id" }))
    ).rejects.toBeInstanceOf(HttpsError);

    expect(logSecurityEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "get_checklist_failed",
        outcome: "failure",
        context: expect.objectContaining({ function: "getChecklist" }),
      })
    );
  });
});
