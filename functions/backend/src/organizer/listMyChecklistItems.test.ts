import { HttpsError } from "firebase-functions/v2/https";
import type { CallableRequest } from "firebase-functions/v2/https";

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
import { listMyChecklistItems } from "./listMyChecklistItems";

function buildRequest(data: Record<string, unknown>, uid: string | null = "user-1"): CallableRequest {
  return {
    auth: uid ? ({ uid } as CallableRequest["auth"]) : undefined,
    data,
    rawRequest: { headers: {} } as CallableRequest["rawRequest"],
  } as CallableRequest;
}

interface QueryChainMock {
  where: jest.Mock;
  get: jest.Mock;
}

function buildChecklistItemQuery(items: Record<string, unknown>[]): QueryChainMock {
  const chain: QueryChainMock = {
    where: jest.fn(),
    get: jest.fn().mockResolvedValue({
      docs: items.map((data) => ({ data: () => data })),
    }),
  };
  chain.where.mockReturnValue(chain);
  return chain;
}

function buildDocSnap(id: string, data: Record<string, unknown> | undefined) {
  return { id, exists: data !== undefined, data: () => data };
}

describe("listMyChecklistItems", () => {
  let usersStore: Record<string, Record<string, unknown> | undefined>;

  beforeEach(() => {
    jest.clearAllMocks();
    usersStore = {};

    docMock.mockImplementation((id: string) => ({
      get: jest.fn().mockResolvedValue(buildDocSnap(id, usersStore[id])),
    }));

    collectionMock.mockImplementation((name: string) => {
      if (name === "users") {
        return { doc: docMock };
      }
      throw new Error(`Unexpected collection ${name} in this test setup`);
    });

    getAllMock.mockResolvedValue([]);
  });

  function mockChecklistItemsQuery(items: Record<string, unknown>[]) {
    const chain = buildChecklistItemQuery(items);
    collectionMock.mockImplementation((name: string) => {
      if (name === "checklistItems") return chain;
      if (name === "users") return { doc: docMock };
      if (name === "checklists") return { doc: docMock };
      throw new Error(`Unexpected collection ${name} in this test setup`);
    });
    return chain;
  }

  // Scenario: un utente vede solo i propri item assegnati attraverso piu' checklist
  it("returns only items assigned to the caller's own uid, regardless of which checklist contains them", async () => {
    const myItems = [
      { id: "item-1", checklistId: "checklist-a", assignee: "user-1", status: "Assegnare", completed: false },
      { id: "item-2", checklistId: "checklist-b", assignee: "user-1", status: "Assegnare", completed: false },
    ];
    const chain = mockChecklistItemsQuery(myItems);

    const result = await listMyChecklistItems.run(buildRequest({}));

    expect(collectionMock).toHaveBeenCalledWith("checklistItems");
    expect(chain.where).toHaveBeenCalledWith("assignee", "==", "user-1");
    expect(chain.where).toHaveBeenCalledTimes(1);
    expect((result as { items: unknown[] }).items).toHaveLength(2);
  });

  // Scenario: il filtro scope applica category direttamente su checklistItems
  it("applies scope as a direct where('category','==', scope) filter on checklistItems, with no post-filter", async () => {
    const items = [
      { id: "item-1", checklistId: "checklist-a", assignee: "user-1", category: "devicetype-mano", status: "Completata", completed: false },
    ];
    const chain = mockChecklistItemsQuery(items);

    const result = await listMyChecklistItems.run(buildRequest({ scope: "devicetype-mano" }));

    expect(chain.where).toHaveBeenNthCalledWith(1, "assignee", "==", "user-1");
    expect(chain.where).toHaveBeenNthCalledWith(2, "category", "==", "devicetype-mano");
    // origin: null aggiunto (nessun checklist match nel batch-read mockato
    // a []): non più "invariato", vedi regressione sotto sul perché origin
    // è ora risolto anche per item completati.
    expect((result as { items: unknown[] }).items).toEqual([{ ...items[0], origin: null }]);
  });

  // Regressione (bug segnalato dall'operatore, pagina "I miei item" —
  // gestione in blocco): origin va risolto per OGNI item, non solo quelli
  // pending, perché il consumer frontend ne ha bisogno anche per risolvere
  // il requestId di un item già completato che l'utente vuole comunque
  // modificare (riaprire, correggere una nota).
  it("resolves origin for every item via a single db.getAll batch read of distinct parent checklists, including completed items", async () => {
    const items = [
      { id: "item-1", checklistId: "checklist-a", assignee: "user-1", type: "generic", status: "Assegnare", completed: false },
      { id: "item-2", checklistId: "checklist-a", assignee: "user-1", type: "generic", status: "Assegnare", completed: false },
      { id: "item-3", checklistId: "checklist-b", assignee: "user-1", type: "generic", status: "Completata", completed: false },
    ];
    mockChecklistItemsQuery(items);
    getAllMock.mockResolvedValue([
      buildDocSnap("checklist-a", { origin: { type: "deviceRequest", id: "req-1" } }),
      buildDocSnap("checklist-b", { origin: { type: "deviceRequest", id: "req-2" } }),
    ]);

    const result = await listMyChecklistItems.run(buildRequest({}));

    expect(getAllMock).toHaveBeenCalledTimes(1);
    expect(getAllMock.mock.calls[0]).toHaveLength(2); // checklist-a e checklist-b, entrambe distinte
    const resultItems = (result as { items: Record<string, unknown>[] }).items;
    expect(resultItems.find((i) => i.id === "item-1")?.origin).toEqual({ type: "deviceRequest", id: "req-1" });
    expect(resultItems.find((i) => i.id === "item-2")?.origin).toEqual({ type: "deviceRequest", id: "req-1" });
    expect(resultItems.find((i) => i.id === "item-3")?.origin).toEqual({ type: "deviceRequest", id: "req-2" });
  });

  it("does not call db.getAll when there are no items at all", async () => {
    mockChecklistItemsQuery([]);

    await listMyChecklistItems.run(buildRequest({}));

    expect(getAllMock).not.toHaveBeenCalled();
  });

  it("resolves origin to null when an item's parent checklist has no origin field", async () => {
    const items = [
      { id: "item-1", checklistId: "checklist-a", assignee: "user-1", status: "Assegnare", completed: false },
    ];
    mockChecklistItemsQuery(items);
    getAllMock.mockResolvedValue([buildDocSnap("checklist-a", { title: "no origin here" })]);

    const result = await listMyChecklistItems.run(buildRequest({}));

    expect((result as { items: Record<string, unknown>[] }).items[0].origin).toBeNull();
  });

  // Scenario: un non-admin non puo' interrogare gli item di un altro utente
  it("rejects with permission-denied when a non-admin passes an explicit uid different from their own", async () => {
    usersStore["user-1"] = { role: "volunteer" };
    mockChecklistItemsQuery([]);

    await expect(
      listMyChecklistItems.run(buildRequest({ uid: "user-2" }))
    ).rejects.toMatchObject(new HttpsError("permission-denied", "Only admin can query another user's checklist items"));

    expect(collectionMock).not.toHaveBeenCalledWith("checklistItems");
  });

  it("allows an admin to query another uid's items explicitly", async () => {
    usersStore["admin-1"] = { role: "admin" };
    const otherUsersItems = [
      { id: "item-9", checklistId: "checklist-z", assignee: "user-2", status: "Completata", completed: false },
    ];
    const chain = mockChecklistItemsQuery(otherUsersItems);

    const result = await listMyChecklistItems.run(buildRequest({ uid: "user-2" }, "admin-1"));

    expect(chain.where).toHaveBeenCalledWith("assignee", "==", "user-2");
    expect((result as { items: unknown[] }).items).toEqual([{ ...otherUsersItems[0], origin: null }]);
  });

  it("does not require an admin check when the explicit uid matches the caller's own uid", async () => {
    mockChecklistItemsQuery([]);

    await listMyChecklistItems.run(buildRequest({ uid: "user-1" }));

    expect(collectionMock).not.toHaveBeenCalledWith("users");
  });

  it("throws unauthenticated when there is no auth context", async () => {
    await expect(
      listMyChecklistItems.run(buildRequest({}, null))
    ).rejects.toMatchObject(new HttpsError("unauthenticated", "User must be authenticated"));

    expect(collectionMock).not.toHaveBeenCalled();
  });

  it("throws invalid-argument when scope is not a non-empty string", async () => {
    await expect(
      listMyChecklistItems.run(buildRequest({ scope: "" }))
    ).rejects.toMatchObject(new HttpsError("invalid-argument", "scope must be a non-empty string"));
  });

  it("logs a success security event when items are listed", async () => {
    mockChecklistItemsQuery([]);

    await listMyChecklistItems.run(buildRequest({}));

    expect(logSecurityEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "list_my_checklist_items",
        outcome: "success",
        context: expect.objectContaining({ function: "listMyChecklistItems" }),
      })
    );
  });

  it("logs a failure security event when permission is denied", async () => {
    usersStore["user-1"] = { role: "volunteer" };
    mockChecklistItemsQuery([]);

    await expect(
      listMyChecklistItems.run(buildRequest({ uid: "user-2" }))
    ).rejects.toBeInstanceOf(HttpsError);

    expect(logSecurityEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "list_my_checklist_items_failed",
        outcome: "failure",
        context: expect.objectContaining({ function: "listMyChecklistItems" }),
      })
    );
  });
});
