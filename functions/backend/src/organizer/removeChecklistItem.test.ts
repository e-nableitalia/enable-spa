import { HttpsError } from "firebase-functions/v2/https";
import type { CallableRequest } from "firebase-functions/v2/https";

const SERVER_TIMESTAMP_SENTINEL = { __type: "serverTimestamp" };

const getMock = jest.fn();
const updateMock = jest.fn().mockResolvedValue(undefined);
const docMock = jest.fn();
const collectionMock = jest.fn();

jest.mock("firebase-admin/firestore", () => ({
  getFirestore: jest.fn(() => ({
    collection: collectionMock,
  })),
  FieldValue: {
    serverTimestamp: jest.fn(() => SERVER_TIMESTAMP_SENTINEL),
  },
}));

jest.mock("../security/securityLog", () => ({
  logSecurityEvent: jest.fn().mockResolvedValue(undefined),
}));

import { removeChecklistItem } from "./removeChecklistItem";

const CHECKLIST_ID = "existing-checklist-id";
const ITEM_ID = "item-1";
const OTHER_ITEM_ID = "item-2";

const ITEM_TO_REMOVE = {
  id: ITEM_ID,
  title: "Prepara stampante",
  assignee: "Mario Rossi",
  quantity: 3,
  notes: "Nota originale",
  status: "Da iniziare",
  completed: false,
};

const OTHER_ITEM = {
  id: OTHER_ITEM_ID,
  title: "Verifica materiale",
  assignee: "Luigi Bianchi",
  quantity: 1,
  notes: "Altra nota",
  status: "In corso",
  completed: false,
};

function buildRequest(data: Record<string, unknown>, uid: string | null = "user-1"): CallableRequest {
  return {
    auth: uid ? ({ uid, token: { email: "user@example.com" } } as CallableRequest["auth"]) : undefined,
    data,
    rawRequest: { headers: {} } as CallableRequest["rawRequest"],
  } as CallableRequest;
}

function buildChecklistSnapshot(items: unknown[]) {
  return {
    exists: true,
    data: () => ({ items }),
  };
}

describe("removeChecklistItem", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getMock.mockResolvedValue(
      buildChecklistSnapshot([{ ...ITEM_TO_REMOVE }, { ...OTHER_ITEM }])
    );
    updateMock.mockResolvedValue(undefined);
    docMock.mockReturnValue({ get: getMock, update: updateMock });
    collectionMock.mockReturnValue({ doc: docMock });
  });

  it("removes the specified item from the checklist items", async () => {
    await removeChecklistItem.run(
      buildRequest({ checklistId: CHECKLIST_ID, itemId: ITEM_ID })
    );

    expect(collectionMock).toHaveBeenCalledWith("checklists");
    expect(docMock).toHaveBeenCalledWith(CHECKLIST_ID);
    expect(updateMock).toHaveBeenCalledTimes(1);

    const [updatePayload] = updateMock.mock.calls[0];
    expect(updatePayload.items).toHaveLength(1);
    expect(
      updatePayload.items.find((item: { id: string }) => item.id === ITEM_ID)
    ).toBeUndefined();
    expect(updatePayload.updatedAt).toBe(SERVER_TIMESTAMP_SENTINEL);
  });

  it("leaves the other items of the same checklist unchanged", async () => {
    await removeChecklistItem.run(
      buildRequest({ checklistId: CHECKLIST_ID, itemId: ITEM_ID })
    );

    const [updatePayload] = updateMock.mock.calls[0];
    const untouchedItem = updatePayload.items.find(
      (item: { id: string }) => item.id === OTHER_ITEM_ID
    );

    expect(untouchedItem).toEqual(OTHER_ITEM);
  });

  it("returns success true", async () => {
    const result = await removeChecklistItem.run(
      buildRequest({ checklistId: CHECKLIST_ID, itemId: ITEM_ID })
    );

    expect(result).toEqual({ success: true });
  });

  it("throws not-found and does not write when the item does not exist in the checklist", async () => {
    await expect(
      removeChecklistItem.run(
        buildRequest({ checklistId: CHECKLIST_ID, itemId: "missing-item" })
      )
    ).rejects.toMatchObject(new HttpsError("not-found", "Checklist item not found"));

    expect(updateMock).not.toHaveBeenCalled();
  });

  it("throws not-found and does not write when the checklist does not exist", async () => {
    getMock.mockResolvedValue({ exists: false });

    await expect(
      removeChecklistItem.run(
        buildRequest({ checklistId: "missing-id", itemId: ITEM_ID })
      )
    ).rejects.toMatchObject(new HttpsError("not-found", "Checklist not found"));

    expect(updateMock).not.toHaveBeenCalled();
  });

  it("throws unauthenticated when the caller is not authenticated", async () => {
    await expect(
      removeChecklistItem.run(
        buildRequest({ checklistId: CHECKLIST_ID, itemId: ITEM_ID }, null)
      )
    ).rejects.toMatchObject(new HttpsError("unauthenticated", "User must be authenticated"));

    expect(updateMock).not.toHaveBeenCalled();
  });

  it("throws invalid-argument when checklistId is missing", async () => {
    await expect(
      removeChecklistItem.run(buildRequest({ itemId: ITEM_ID }))
    ).rejects.toMatchObject(new HttpsError("invalid-argument", "Missing checklistId"));

    expect(updateMock).not.toHaveBeenCalled();
  });

  it("throws invalid-argument when itemId is missing", async () => {
    await expect(
      removeChecklistItem.run(buildRequest({ checklistId: CHECKLIST_ID }))
    ).rejects.toMatchObject(new HttpsError("invalid-argument", "Missing itemId"));

    expect(updateMock).not.toHaveBeenCalled();
  });
});
