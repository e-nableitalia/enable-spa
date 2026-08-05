import { HttpsError } from "firebase-functions/v2/https";
import type { CallableRequest } from "firebase-functions/v2/https";

const SERVER_TIMESTAMP_SENTINEL = { __type: "serverTimestamp" };
const CREATION_DATE_SENTINEL = { __type: "creationDate" };

const checklistGetMock = jest.fn();
const checklistDocMock = jest.fn();
const itemGetMock = jest.fn();
const itemUpdateMock = jest.fn().mockResolvedValue(undefined);
const itemDocMock = jest.fn();
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

import { updateChecklistItem } from "./updateChecklistItem";

const CHECKLIST_ID = "existing-checklist-id";
const ITEM_ID = "item-1";

function buildRequest(data: Record<string, unknown>, uid: string | null = "user-1"): CallableRequest {
  return {
    auth: uid ? ({ uid, token: { email: "user@example.com" } } as CallableRequest["auth"]) : undefined,
    data,
    rawRequest: { headers: {} } as CallableRequest["rawRequest"],
  } as CallableRequest;
}

function setItem(overrides: Record<string, unknown>) {
  itemGetMock.mockResolvedValue({
    exists: true,
    data: () => ({
      id: ITEM_ID,
      checklistId: CHECKLIST_ID,
      category: "devicetype-mano",
      title: "Prepara stampante",
      type: "generic",
      assignee: "Mario Rossi",
      quantity: 3,
      notes: "Nota originale",
      status: "Da iniziare",
      completed: false,
      creationDate: CREATION_DATE_SENTINEL,
      dueDate: null,
      completionDate: null,
      ...overrides,
    }),
  });
}

describe("updateChecklistItem", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    checklistGetMock.mockResolvedValue({ exists: true });
    itemUpdateMock.mockResolvedValue(undefined);
    checklistDocMock.mockReturnValue({ get: checklistGetMock });
    itemDocMock.mockReturnValue({ get: itemGetMock, update: itemUpdateMock });
    collectionMock.mockImplementation((name: string) =>
      name === "checklists" ? { doc: checklistDocMock } : { doc: itemDocMock }
    );
    setItem({});
  });

  // Scenario: updateChecklistItem aggiorna parzialmente il documento checklistItems corrispondente
  it("updates only the status field on the checklistItems document, without touching other fields", async () => {
    await updateChecklistItem.run(
      buildRequest({ checklistId: CHECKLIST_ID, itemId: ITEM_ID, status: "In corso" })
    );

    expect(collectionMock).toHaveBeenCalledWith("checklistItems");
    expect(itemDocMock).toHaveBeenCalledWith(ITEM_ID);
    expect(itemUpdateMock).toHaveBeenCalledTimes(1);
    expect(itemUpdateMock).toHaveBeenCalledWith({
      status: "In corso",
      updatedAt: SERVER_TIMESTAMP_SENTINEL,
    });
  });

  it("updates only the title field", async () => {
    await updateChecklistItem.run(
      buildRequest({ checklistId: CHECKLIST_ID, itemId: ITEM_ID, title: "Prepara stampante 3D" })
    );

    expect(itemUpdateMock).toHaveBeenCalledWith({
      title: "Prepara stampante 3D",
      updatedAt: SERVER_TIMESTAMP_SENTINEL,
    });
  });

  it("updates only the assignee field", async () => {
    await updateChecklistItem.run(
      buildRequest({ checklistId: CHECKLIST_ID, itemId: ITEM_ID, assignee: "Nuovo Assegnatario" })
    );

    expect(itemUpdateMock).toHaveBeenCalledWith({
      assignee: "Nuovo Assegnatario",
      updatedAt: SERVER_TIMESTAMP_SENTINEL,
    });
  });

  it("updates only the quantity field", async () => {
    await updateChecklistItem.run(
      buildRequest({ checklistId: CHECKLIST_ID, itemId: ITEM_ID, quantity: 10 })
    );

    expect(itemUpdateMock).toHaveBeenCalledWith({
      quantity: 10,
      updatedAt: SERVER_TIMESTAMP_SENTINEL,
    });
  });

  it("updates only the notes field", async () => {
    await updateChecklistItem.run(
      buildRequest({ checklistId: CHECKLIST_ID, itemId: ITEM_ID, notes: "Nota aggiornata" })
    );

    expect(itemUpdateMock).toHaveBeenCalledWith({
      notes: "Nota aggiornata",
      updatedAt: SERVER_TIMESTAMP_SENTINEL,
    });
  });

  it("updates multiple specified fields at once (title and notes), without touching completionDate", async () => {
    await updateChecklistItem.run(
      buildRequest({
        checklistId: CHECKLIST_ID,
        itemId: ITEM_ID,
        title: "Prepara stampante 3D",
        notes: "Nota aggiornata",
      })
    );

    expect(itemUpdateMock).toHaveBeenCalledWith({
      title: "Prepara stampante 3D",
      notes: "Nota aggiornata",
      updatedAt: SERVER_TIMESTAMP_SENTINEL,
    });
  });

  // Scenario: creationDate, dueDate, completionDate restano invariati se non esplicitamente forniti
  it("does not include creationDate, dueDate or completed in the update payload when only title is provided", async () => {
    await updateChecklistItem.run(
      buildRequest({ checklistId: CHECKLIST_ID, itemId: ITEM_ID, title: "Prepara stampante 3D" })
    );

    const [updatePayload] = itemUpdateMock.mock.calls[0];
    expect(updatePayload).not.toHaveProperty("creationDate");
    expect(updatePayload).not.toHaveProperty("dueDate");
    expect(updatePayload).not.toHaveProperty("completed");
    expect(updatePayload).not.toHaveProperty("completionDate");
  });

  // Scenario 3: updateChecklistItem con nuovo type valido
  it.each(["boolean", "generic", "numeric"] as const)(
    "updates only the type field to '%s'",
    async (type) => {
      await updateChecklistItem.run(
        buildRequest({ checklistId: CHECKLIST_ID, itemId: ITEM_ID, type })
      );

      expect(itemUpdateMock).toHaveBeenCalledWith({
        type,
        updatedAt: SERVER_TIMESTAMP_SENTINEL,
      });
    }
  );

  // Scenario 4: updateChecklistItem con type non valido
  it("throws invalid-argument and does not write when type is not among the 3 allowed", async () => {
    await expect(
      updateChecklistItem.run(
        buildRequest({ checklistId: CHECKLIST_ID, itemId: ITEM_ID, type: "unknown-type" })
      )
    ).rejects.toMatchObject(
      new HttpsError("invalid-argument", "Each item must have a valid type ('boolean' | 'generic' | 'numeric')")
    );

    expect(itemUpdateMock).not.toHaveBeenCalled();
  });

  it("throws invalid-argument when no field to update is provided", async () => {
    await expect(
      updateChecklistItem.run(buildRequest({ checklistId: CHECKLIST_ID, itemId: ITEM_ID }))
    ).rejects.toMatchObject(new HttpsError("invalid-argument", "At least one field to update must be provided"));

    expect(itemUpdateMock).not.toHaveBeenCalled();
  });

  it("throws not-found and does not write when the checklist does not exist", async () => {
    checklistGetMock.mockResolvedValue({ exists: false });

    await expect(
      updateChecklistItem.run(
        buildRequest({ checklistId: "missing-checklist", itemId: ITEM_ID, title: "Titolo" })
      )
    ).rejects.toMatchObject(new HttpsError("not-found", "Checklist not found"));

    expect(itemUpdateMock).not.toHaveBeenCalled();
  });

  it("throws not-found and does not write when the item does not exist", async () => {
    itemGetMock.mockResolvedValue({ exists: false });

    await expect(
      updateChecklistItem.run(
        buildRequest({ checklistId: CHECKLIST_ID, itemId: "missing-item", title: "Titolo" })
      )
    ).rejects.toMatchObject(new HttpsError("not-found", "Checklist item not found"));

    expect(itemUpdateMock).not.toHaveBeenCalled();
  });

  it("throws not-found and does not write when the item belongs to a different checklist", async () => {
    setItem({ checklistId: "other-checklist-id" });

    await expect(
      updateChecklistItem.run(
        buildRequest({ checklistId: CHECKLIST_ID, itemId: ITEM_ID, title: "Titolo" })
      )
    ).rejects.toMatchObject(new HttpsError("not-found", "Checklist item not found"));

    expect(itemUpdateMock).not.toHaveBeenCalled();
  });

  it("throws unauthenticated when the caller is not authenticated", async () => {
    await expect(
      updateChecklistItem.run(
        buildRequest({ checklistId: CHECKLIST_ID, itemId: ITEM_ID, title: "Titolo" }, null)
      )
    ).rejects.toMatchObject(new HttpsError("unauthenticated", "User must be authenticated"));

    expect(itemUpdateMock).not.toHaveBeenCalled();
  });

  describe("automatic completionDate on gate transition (generic/numeric items)", () => {
    // Scenario: updateChecklistItem valorizza automaticamente completionDate quando il gate transita a true (generic)
    it("sets completionDate when a generic item becomes complete (assignee set, status 'Completata')", async () => {
      setItem({ type: "generic", assignee: null, status: "Assegnare", quantity: null });

      await updateChecklistItem.run(
        buildRequest({
          checklistId: CHECKLIST_ID,
          itemId: ITEM_ID,
          assignee: "Mario Rossi",
          status: "Completata",
        })
      );

      expect(itemUpdateMock).toHaveBeenCalledWith({
        assignee: "Mario Rossi",
        status: "Completata",
        completionDate: SERVER_TIMESTAMP_SENTINEL,
        updatedAt: SERVER_TIMESTAMP_SENTINEL,
      });
    });

    // Scenario: updateChecklistItem valorizza automaticamente completionDate quando il gate transita a true (numeric)
    it("sets completionDate when a numeric item becomes complete (assignee set, quantity set, status 'Completata')", async () => {
      setItem({ type: "numeric", assignee: null, status: "Assegnare", quantity: null });

      await updateChecklistItem.run(
        buildRequest({
          checklistId: CHECKLIST_ID,
          itemId: ITEM_ID,
          assignee: "Mario Rossi",
          quantity: 5,
          status: "Completata",
        })
      );

      expect(itemUpdateMock).toHaveBeenCalledWith({
        assignee: "Mario Rossi",
        quantity: 5,
        status: "Completata",
        completionDate: SERVER_TIMESTAMP_SENTINEL,
        updatedAt: SERVER_TIMESTAMP_SENTINEL,
      });
    });

    it("does not set completionDate for a numeric item missing quantity even if status becomes 'Completata'", async () => {
      setItem({ type: "numeric", assignee: "Mario Rossi", status: "Assegnare", quantity: null });

      await updateChecklistItem.run(
        buildRequest({ checklistId: CHECKLIST_ID, itemId: ITEM_ID, status: "Completata" })
      );

      const [updatePayload] = itemUpdateMock.mock.calls[0];
      expect(updatePayload).not.toHaveProperty("completionDate");
    });

    it("does not re-set completionDate when the item was already complete before the update", async () => {
      setItem({ type: "generic", assignee: "Mario Rossi", status: "Completata" });

      await updateChecklistItem.run(
        buildRequest({ checklistId: CHECKLIST_ID, itemId: ITEM_ID, notes: "Nota aggiornata" })
      );

      const [updatePayload] = itemUpdateMock.mock.calls[0];
      expect(updatePayload).not.toHaveProperty("completionDate");
    });

    // Dipendenza nota EA-134/EA-135: `completed` non è scrivibile da updateChecklistItem in questa
    // Story, quindi il ramo boolean del gate resta sempre irraggiungibile
    it("never sets completionDate for a boolean item, since 'completed' is not writable by this function yet", async () => {
      setItem({ type: "boolean", assignee: null, completed: false, status: "Assegnare" });

      await updateChecklistItem.run(
        buildRequest({ checklistId: CHECKLIST_ID, itemId: ITEM_ID, assignee: "Mario Rossi", status: "Completata" })
      );

      const [updatePayload] = itemUpdateMock.mock.calls[0];
      expect(updatePayload).not.toHaveProperty("completionDate");
    });
  });
});
