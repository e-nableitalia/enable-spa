import { HttpsError } from "firebase-functions/v2/https";
import type { CallableRequest } from "firebase-functions/v2/https";

const SERVER_TIMESTAMP_SENTINEL = { __type: "serverTimestamp" };

const checklistGetMock = jest.fn();
const checklistDocMock = jest.fn();
const itemGetMock = jest.fn();
const itemDocMock = jest.fn();
const collectionMock = jest.fn();
const batchDeleteMock = jest.fn();
const batchUpdateMock = jest.fn();
const batchCommitMock = jest.fn().mockResolvedValue(undefined);

jest.mock("firebase-admin/firestore", () => ({
  getFirestore: jest.fn(() => ({
    collection: collectionMock,
    batch: jest.fn(() => ({
      delete: batchDeleteMock,
      update: batchUpdateMock,
      commit: batchCommitMock,
    })),
  })),
  FieldValue: {
    serverTimestamp: jest.fn(() => SERVER_TIMESTAMP_SENTINEL),
    arrayRemove: jest.fn((...items: unknown[]) => ({ __type: "arrayRemove", items })),
  },
}));

jest.mock("../security/securityLog", () => ({
  logSecurityEvent: jest.fn().mockResolvedValue(undefined),
}));

import { removeChecklistItem } from "./removeChecklistItem";

const CHECKLIST_ID = "existing-checklist-id";
const ITEM_ID = "item-1";

function buildRequest(data: Record<string, unknown>, uid: string | null = "user-1"): CallableRequest {
  return {
    auth: uid ? ({ uid, token: { email: "user@example.com" } } as CallableRequest["auth"]) : undefined,
    data,
    rawRequest: { headers: {} } as CallableRequest["rawRequest"],
  } as CallableRequest;
}

function setItem(overrides: Record<string, unknown> | null) {
  if (overrides === null) {
    itemGetMock.mockResolvedValue({ exists: false });
    return;
  }
  itemGetMock.mockResolvedValue({
    exists: true,
    data: () => ({
      id: ITEM_ID,
      checklistId: CHECKLIST_ID,
      category: "devicetype-mano",
      title: "Prepara stampante",
      ...overrides,
    }),
  });
}

describe("removeChecklistItem", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    checklistGetMock.mockResolvedValue({ exists: true });
    batchCommitMock.mockResolvedValue(undefined);
    checklistDocMock.mockReturnValue({ get: checklistGetMock });
    itemDocMock.mockReturnValue({ get: itemGetMock });
    collectionMock.mockImplementation((name: string) =>
      name === "checklists" ? { doc: checklistDocMock } : { doc: itemDocMock }
    );
    setItem({});
  });

  // Scenario: removeChecklistItem elimina il documento checklistItems e il riferimento sulla checklist padre
  it("deletes the checklistItems document for the given itemId", async () => {
    await removeChecklistItem.run(buildRequest({ checklistId: CHECKLIST_ID, itemId: ITEM_ID }));

    expect(collectionMock).toHaveBeenCalledWith("checklists");
    expect(collectionMock).toHaveBeenCalledWith("checklistItems");
    expect(checklistDocMock).toHaveBeenCalledWith(CHECKLIST_ID);
    expect(itemDocMock).toHaveBeenCalledWith(ITEM_ID);
    expect(batchDeleteMock).toHaveBeenCalledTimes(1);
    expect(batchDeleteMock).toHaveBeenCalledWith(itemDocMock.mock.results[0].value);
  });

  // Scenario: removeChecklistItem elimina il documento checklistItems e il riferimento sulla checklist padre
  it("removes the itemId from the parent checklist's items array", async () => {
    await removeChecklistItem.run(buildRequest({ checklistId: CHECKLIST_ID, itemId: ITEM_ID }));

    expect(batchUpdateMock).toHaveBeenCalledTimes(1);
    const [checklistRef, updatePayload] = batchUpdateMock.mock.calls[0];
    expect(checklistRef).toBe(checklistDocMock.mock.results[0].value);
    expect(updatePayload.items).toEqual({ __type: "arrayRemove", items: [ITEM_ID] });
    expect(updatePayload.updatedAt).toBe(SERVER_TIMESTAMP_SENTINEL);
    expect(batchCommitMock).toHaveBeenCalledTimes(1);
  });

  it("returns success true", async () => {
    const result = await removeChecklistItem.run(buildRequest({ checklistId: CHECKLIST_ID, itemId: ITEM_ID }));

    expect(result).toEqual({ success: true });
  });

  it("throws not-found and does not write when the item does not exist", async () => {
    setItem(null);

    await expect(
      removeChecklistItem.run(buildRequest({ checklistId: CHECKLIST_ID, itemId: "missing-item" }))
    ).rejects.toMatchObject(new HttpsError("not-found", "Checklist item not found"));

    expect(batchCommitMock).not.toHaveBeenCalled();
  });

  it("throws not-found and does not write when the item belongs to a different checklist", async () => {
    setItem({ checklistId: "other-checklist-id" });

    await expect(
      removeChecklistItem.run(buildRequest({ checklistId: CHECKLIST_ID, itemId: ITEM_ID }))
    ).rejects.toMatchObject(new HttpsError("not-found", "Checklist item not found"));

    expect(batchCommitMock).not.toHaveBeenCalled();
  });

  it("throws not-found and does not write when the checklist does not exist", async () => {
    checklistGetMock.mockResolvedValue({ exists: false });

    await expect(
      removeChecklistItem.run(buildRequest({ checklistId: "missing-id", itemId: ITEM_ID }))
    ).rejects.toMatchObject(new HttpsError("not-found", "Checklist not found"));

    expect(batchCommitMock).not.toHaveBeenCalled();
  });

  it("throws unauthenticated when the caller is not authenticated", async () => {
    await expect(
      removeChecklistItem.run(buildRequest({ checklistId: CHECKLIST_ID, itemId: ITEM_ID }, null))
    ).rejects.toMatchObject(new HttpsError("unauthenticated", "User must be authenticated"));

    expect(batchCommitMock).not.toHaveBeenCalled();
  });

  it("throws invalid-argument when checklistId is missing", async () => {
    await expect(
      removeChecklistItem.run(buildRequest({ itemId: ITEM_ID }))
    ).rejects.toMatchObject(new HttpsError("invalid-argument", "Missing checklistId"));

    expect(batchCommitMock).not.toHaveBeenCalled();
  });

  it("throws invalid-argument when itemId is missing", async () => {
    await expect(
      removeChecklistItem.run(buildRequest({ checklistId: CHECKLIST_ID }))
    ).rejects.toMatchObject(new HttpsError("invalid-argument", "Missing itemId"));

    expect(batchCommitMock).not.toHaveBeenCalled();
  });
});
