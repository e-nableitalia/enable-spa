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

import { updateChecklistItem } from "./updateChecklistItem";

const CHECKLIST_ID = "existing-checklist-id";
const ITEM_ID = "item-1";
const OTHER_ITEM_ID = "item-2";

const ORIGINAL_ITEM = {
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

describe("updateChecklistItem", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getMock.mockResolvedValue(
      buildChecklistSnapshot([{ ...ORIGINAL_ITEM }, { ...OTHER_ITEM }])
    );
    updateMock.mockResolvedValue(undefined);
    docMock.mockReturnValue({ get: getMock, update: updateMock });
    collectionMock.mockReturnValue({ doc: docMock });
  });

  it("updates only the status field, leaving assignee, quantity, notes and completed unchanged", async () => {
    await updateChecklistItem.run(
      buildRequest({ checklistId: CHECKLIST_ID, itemId: ITEM_ID, status: "In corso" })
    );

    expect(updateMock).toHaveBeenCalledTimes(1);
    const [updatePayload] = updateMock.mock.calls[0];
    const updatedItem = updatePayload.items.find((item: { id: string }) => item.id === ITEM_ID);

    expect(updatedItem).toEqual({
      ...ORIGINAL_ITEM,
      status: "In corso",
    });
    expect(updatePayload.updatedAt).toBe(SERVER_TIMESTAMP_SENTINEL);
  });

  it("updates only the assignee field, leaving status, quantity, notes and completed unchanged", async () => {
    await updateChecklistItem.run(
      buildRequest({ checklistId: CHECKLIST_ID, itemId: ITEM_ID, assignee: "Nuovo Assegnatario" })
    );

    const [updatePayload] = updateMock.mock.calls[0];
    const updatedItem = updatePayload.items.find((item: { id: string }) => item.id === ITEM_ID);

    expect(updatedItem).toEqual({
      ...ORIGINAL_ITEM,
      assignee: "Nuovo Assegnatario",
    });
  });

  it("updates only the quantity field, leaving status, assignee, notes and completed unchanged", async () => {
    await updateChecklistItem.run(
      buildRequest({ checklistId: CHECKLIST_ID, itemId: ITEM_ID, quantity: 10 })
    );

    const [updatePayload] = updateMock.mock.calls[0];
    const updatedItem = updatePayload.items.find((item: { id: string }) => item.id === ITEM_ID);

    expect(updatedItem).toEqual({
      ...ORIGINAL_ITEM,
      quantity: 10,
    });
  });

  it("updates only the notes field, leaving status, assignee, quantity and completed unchanged", async () => {
    await updateChecklistItem.run(
      buildRequest({ checklistId: CHECKLIST_ID, itemId: ITEM_ID, notes: "Nota aggiornata" })
    );

    const [updatePayload] = updateMock.mock.calls[0];
    const updatedItem = updatePayload.items.find((item: { id: string }) => item.id === ITEM_ID);

    expect(updatedItem).toEqual({
      ...ORIGINAL_ITEM,
      notes: "Nota aggiornata",
    });
  });

  it("updates multiple specified fields at once, leaving the remaining fields unchanged", async () => {
    await updateChecklistItem.run(
      buildRequest({
        checklistId: CHECKLIST_ID,
        itemId: ITEM_ID,
        status: "Completata",
        quantity: 5,
      })
    );

    const [updatePayload] = updateMock.mock.calls[0];
    const updatedItem = updatePayload.items.find((item: { id: string }) => item.id === ITEM_ID);

    expect(updatedItem).toEqual({
      ...ORIGINAL_ITEM,
      status: "Completata",
      quantity: 5,
    });
  });

  it("does not modify other items in the checklist", async () => {
    await updateChecklistItem.run(
      buildRequest({ checklistId: CHECKLIST_ID, itemId: ITEM_ID, status: "Completata" })
    );

    const [updatePayload] = updateMock.mock.calls[0];
    const untouchedItem = updatePayload.items.find((item: { id: string }) => item.id === OTHER_ITEM_ID);

    expect(untouchedItem).toEqual(OTHER_ITEM);
  });
});
