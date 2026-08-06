import { HttpsError } from "firebase-functions/v2/https";
import type { CallableRequest } from "firebase-functions/v2/https";

const SERVER_TIMESTAMP_SENTINEL = { __type: "serverTimestamp" };

const getMock = jest.fn();
const checklistDocMock = jest.fn();
const checklistItemDocMock = jest.fn();
const collectionMock = jest.fn();
const batchSetMock = jest.fn();
const batchUpdateMock = jest.fn();
const batchCommitMock = jest.fn().mockResolvedValue(undefined);

let checklistItemDocCounter = 0;

function newChecklistItemDoc() {
  checklistItemDocCounter += 1;
  return { id: `generated-item-id-${checklistItemDocCounter}` };
}

jest.mock("firebase-admin/firestore", () => ({
  getFirestore: jest.fn(() => ({
    collection: collectionMock,
    batch: jest.fn(() => ({
      set: batchSetMock,
      update: batchUpdateMock,
      commit: batchCommitMock,
    })),
  })),
  FieldValue: {
    serverTimestamp: jest.fn(() => SERVER_TIMESTAMP_SENTINEL),
    arrayUnion: jest.fn((...items: unknown[]) => ({ __type: "arrayUnion", items })),
  },
}));

jest.mock("../security/securityLog", () => ({
  logSecurityEvent: jest.fn().mockResolvedValue(undefined),
}));

import { addChecklistItem } from "./addChecklistItem";

function buildRequest(data: Record<string, unknown>, uid: string | null = "user-1"): CallableRequest {
  return {
    auth: uid ? ({ uid, token: { email: "user@example.com" } } as CallableRequest["auth"]) : undefined,
    data,
    rawRequest: { headers: {} } as CallableRequest["rawRequest"],
  } as CallableRequest;
}

describe("addChecklistItem", () => {
  const CHECKLIST_ID = "existing-checklist-id";

  beforeEach(() => {
    jest.clearAllMocks();
    checklistItemDocCounter = 0;
    getMock.mockResolvedValue({ exists: true, data: () => ({ category: "devicetype-mano" }) });
    batchCommitMock.mockResolvedValue(undefined);
    checklistDocMock.mockReturnValue({ get: getMock });
    checklistItemDocMock.mockImplementation(newChecklistItemDoc);
    collectionMock.mockImplementation((name: string) =>
      name === "checklists" ? { doc: checklistDocMock } : { doc: checklistItemDocMock }
    );
  });

  // Scenario: addChecklistItem crea un nuovo documento checklistItems invece di arrayUnion
  it("creates a new checklistItems document with category denormalized from the parent checklist, status 'Assegnare' and completed false", async () => {
    await addChecklistItem.run(
      buildRequest({ checklistId: CHECKLIST_ID, title: "Prepara stampante", type: "generic" })
    );

    expect(collectionMock).toHaveBeenCalledWith("checklists");
    expect(collectionMock).toHaveBeenCalledWith("checklistItems");
    expect(checklistDocMock).toHaveBeenCalledWith(CHECKLIST_ID);
    expect(batchSetMock).toHaveBeenCalledTimes(1);

    const [itemRef, newItemDocument] = batchSetMock.mock.calls[0];
    expect(newItemDocument).toEqual({
      id: itemRef.id,
      checklistId: CHECKLIST_ID,
      category: "devicetype-mano",
      title: "Prepara stampante",
      type: "generic",
      assignee: null,
      quantity: null,
      notes: "",
      status: "Assegnare",
      completed: false,
      creationDate: SERVER_TIMESTAMP_SENTINEL,
      dueDate: null,
      completionDate: null,
    });
  });

  // Scenario: addChecklistItem crea un nuovo documento checklistItems invece di arrayUnion
  it("adds the new itemId to the parent checklist's items array", async () => {
    const result = await addChecklistItem.run(
      buildRequest({ checklistId: CHECKLIST_ID, title: "Prepara stampante", type: "generic" })
    );

    expect(batchUpdateMock).toHaveBeenCalledTimes(1);
    const [checklistRef, updatePayload] = batchUpdateMock.mock.calls[0];
    expect(checklistRef).toBe(checklistDocMock.mock.results[0].value);
    expect(updatePayload.items).toEqual({ __type: "arrayUnion", items: [(result as { itemId: string }).itemId] });
    expect(updatePayload.updatedAt).toBe(SERVER_TIMESTAMP_SENTINEL);
    expect(batchCommitMock).toHaveBeenCalledTimes(1);
  });

  // Scenario 1: addChecklistItem con type valido
  it.each(["boolean", "generic", "numeric"] as const)(
    "adds the new item with the provided type '%s'",
    async (type) => {
      await addChecklistItem.run(
        buildRequest({ checklistId: CHECKLIST_ID, title: "Verifica dita", type })
      );

      const [, newItemDocument] = batchSetMock.mock.calls[0];
      expect(newItemDocument.type).toBe(type);
    }
  );

  it("returns the generated itemId to the consumer", async () => {
    const result = await addChecklistItem.run(
      buildRequest({ checklistId: CHECKLIST_ID, title: "Verifica materiale", type: "numeric" })
    );

    expect(result).toHaveProperty("itemId");
    expect(typeof (result as { itemId: string }).itemId).toBe("string");

    const [itemRef] = batchSetMock.mock.calls[0];
    expect((result as { itemId: string }).itemId).toBe(itemRef.id);
  });

  it("generates a unique itemId on every call", async () => {
    const first = await addChecklistItem.run(
      buildRequest({ checklistId: CHECKLIST_ID, title: "Item uno", type: "generic" })
    );
    const second = await addChecklistItem.run(
      buildRequest({ checklistId: CHECKLIST_ID, title: "Item due", type: "generic" })
    );

    expect((first as { itemId: string }).itemId).not.toBe((second as { itemId: string }).itemId);
  });

  it("throws not-found and does not write when the checklist does not exist", async () => {
    getMock.mockResolvedValue({ exists: false });

    await expect(
      addChecklistItem.run(buildRequest({ checklistId: "missing-id", title: "Titolo", type: "generic" }))
    ).rejects.toMatchObject(new HttpsError("not-found", "Checklist not found"));

    expect(batchCommitMock).not.toHaveBeenCalled();
  });

  it("throws unauthenticated when the caller is not authenticated", async () => {
    await expect(
      addChecklistItem.run(
        buildRequest({ checklistId: CHECKLIST_ID, title: "Titolo", type: "generic" }, null)
      )
    ).rejects.toMatchObject(new HttpsError("unauthenticated", "User must be authenticated"));

    expect(batchCommitMock).not.toHaveBeenCalled();
  });

  it("throws invalid-argument when checklistId is missing", async () => {
    await expect(
      addChecklistItem.run(buildRequest({ title: "Titolo", type: "generic" }))
    ).rejects.toMatchObject(new HttpsError("invalid-argument", "Missing checklistId"));

    expect(batchCommitMock).not.toHaveBeenCalled();
  });

  it("throws invalid-argument when title is missing", async () => {
    await expect(
      addChecklistItem.run(buildRequest({ checklistId: CHECKLIST_ID, type: "generic" }))
    ).rejects.toMatchObject(new HttpsError("invalid-argument", "Missing title"));

    expect(batchCommitMock).not.toHaveBeenCalled();
  });

  // Scenario 2: addChecklistItem senza type o con type non valido
  it("throws invalid-argument when type is missing", async () => {
    await expect(
      addChecklistItem.run(buildRequest({ checklistId: CHECKLIST_ID, title: "Titolo" }))
    ).rejects.toMatchObject(
      new HttpsError("invalid-argument", "Each item must have a valid type ('boolean' | 'generic' | 'numeric')")
    );

    expect(batchCommitMock).not.toHaveBeenCalled();
  });

  // Scenario 2: addChecklistItem senza type o con type non valido
  it("throws invalid-argument when type is not among the 3 allowed", async () => {
    await expect(
      addChecklistItem.run(
        buildRequest({ checklistId: CHECKLIST_ID, title: "Titolo", type: "unknown-type" })
      )
    ).rejects.toMatchObject(
      new HttpsError("invalid-argument", "Each item must have a valid type ('boolean' | 'generic' | 'numeric')")
    );

    expect(batchCommitMock).not.toHaveBeenCalled();
  });
});
