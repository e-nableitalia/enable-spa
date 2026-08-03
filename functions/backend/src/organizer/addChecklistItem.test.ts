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
    getMock.mockResolvedValue({ exists: true });
    updateMock.mockResolvedValue(undefined);
    docMock.mockReturnValue({ get: getMock, update: updateMock });
    collectionMock.mockReturnValue({ doc: docMock });
  });

  it("adds the new item with status 'Assegnare' and completed set to false", async () => {
    await addChecklistItem.run(
      buildRequest({ checklistId: CHECKLIST_ID, title: "Prepara stampante", type: "generic" })
    );

    expect(collectionMock).toHaveBeenCalledWith("checklists");
    expect(docMock).toHaveBeenCalledWith(CHECKLIST_ID);
    expect(updateMock).toHaveBeenCalledTimes(1);

    const [updatePayload] = updateMock.mock.calls[0];
    const [newItem] = updatePayload.items.items;

    expect(newItem).toMatchObject({
      title: "Prepara stampante",
      type: "generic",
      status: "Assegnare",
      completed: false,
    });
    expect(typeof newItem.id).toBe("string");
    expect(newItem.id.length).toBeGreaterThan(0);
    expect(updatePayload.updatedAt).toBe(SERVER_TIMESTAMP_SENTINEL);
  });

  // Scenario 1: addChecklistItem con type valido
  it.each(["boolean", "generic", "numeric"] as const)(
    "adds the new item with the provided type '%s'",
    async (type) => {
      await addChecklistItem.run(
        buildRequest({ checklistId: CHECKLIST_ID, title: "Verifica dita", type })
      );

      const [updatePayload] = updateMock.mock.calls[0];
      const [newItem] = updatePayload.items.items;
      expect(newItem.type).toBe(type);
    }
  );

  it("returns the generated itemId to the consumer", async () => {
    const result = await addChecklistItem.run(
      buildRequest({ checklistId: CHECKLIST_ID, title: "Verifica materiale", type: "numeric" })
    );

    expect(result).toHaveProperty("itemId");
    expect(typeof result.itemId).toBe("string");
    expect(result.itemId.length).toBeGreaterThan(0);

    const [updatePayload] = updateMock.mock.calls[0];
    const [newItem] = updatePayload.items.items;
    expect(result.itemId).toBe(newItem.id);
  });

  it("generates a unique itemId on every call", async () => {
    const first = await addChecklistItem.run(
      buildRequest({ checklistId: CHECKLIST_ID, title: "Item uno", type: "generic" })
    );
    const second = await addChecklistItem.run(
      buildRequest({ checklistId: CHECKLIST_ID, title: "Item due", type: "generic" })
    );

    expect(first.itemId).not.toBe(second.itemId);
  });

  it("throws not-found and does not write when the checklist does not exist", async () => {
    getMock.mockResolvedValue({ exists: false });

    await expect(
      addChecklistItem.run(buildRequest({ checklistId: "missing-id", title: "Titolo", type: "generic" }))
    ).rejects.toMatchObject(new HttpsError("not-found", "Checklist not found"));

    expect(updateMock).not.toHaveBeenCalled();
  });

  it("throws unauthenticated when the caller is not authenticated", async () => {
    await expect(
      addChecklistItem.run(
        buildRequest({ checklistId: CHECKLIST_ID, title: "Titolo", type: "generic" }, null)
      )
    ).rejects.toMatchObject(new HttpsError("unauthenticated", "User must be authenticated"));

    expect(updateMock).not.toHaveBeenCalled();
  });

  it("throws invalid-argument when checklistId is missing", async () => {
    await expect(
      addChecklistItem.run(buildRequest({ title: "Titolo", type: "generic" }))
    ).rejects.toMatchObject(new HttpsError("invalid-argument", "Missing checklistId"));

    expect(updateMock).not.toHaveBeenCalled();
  });

  it("throws invalid-argument when title is missing", async () => {
    await expect(
      addChecklistItem.run(buildRequest({ checklistId: CHECKLIST_ID, type: "generic" }))
    ).rejects.toMatchObject(new HttpsError("invalid-argument", "Missing title"));

    expect(updateMock).not.toHaveBeenCalled();
  });

  // Scenario 2: addChecklistItem senza type o con type non valido
  it("throws invalid-argument when type is missing", async () => {
    await expect(
      addChecklistItem.run(buildRequest({ checklistId: CHECKLIST_ID, title: "Titolo" }))
    ).rejects.toMatchObject(
      new HttpsError("invalid-argument", "Each item must have a valid type ('boolean' | 'generic' | 'numeric')")
    );

    expect(updateMock).not.toHaveBeenCalled();
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

    expect(updateMock).not.toHaveBeenCalled();
  });
});
