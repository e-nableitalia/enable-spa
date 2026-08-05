import type { Firestore } from "firebase-admin/firestore";
import { resolveChecklistItems } from "./resolveChecklistItems";

function buildItemSnap(id: string, data: Record<string, unknown> | undefined) {
  return {
    id,
    exists: data !== undefined,
    data: () => data,
  };
}

function buildDb(getAllImpl: (...refs: { id: string }[]) => unknown[]) {
  const docMock = jest.fn((id: string) => ({ id }));
  const collectionMock = jest.fn(() => ({ doc: docMock }));
  const getAllMock = jest.fn((...refs: { id: string }[]) => Promise.resolve(getAllImpl(...refs)));

  return {
    db: { collection: collectionMock, getAll: getAllMock } as unknown as Firestore,
    collectionMock,
    docMock,
    getAllMock,
  };
}

describe("resolveChecklistItems", () => {
  // Scenario: getChecklist ricostruisce items risolvendo i riferimenti per una checklist sotto i 30 item
  it("resolves each itemId to the corresponding checklistItems document via db.getAll", async () => {
    const items: Record<string, Record<string, unknown>> = {
      "item-1": { id: "item-1", title: "Prepara stampante", status: "Assegnare" },
      "item-2": { id: "item-2", title: "Verifica materiale", status: "Completata" },
    };
    const { db, collectionMock, getAllMock } = buildDb((...refs) =>
      refs.map((ref) => buildItemSnap(ref.id, items[ref.id]))
    );

    const result = await resolveChecklistItems(db, ["item-1", "item-2"]);

    expect(collectionMock).toHaveBeenCalledWith("checklistItems");
    expect(getAllMock).toHaveBeenCalledTimes(1);
    expect(result).toEqual([items["item-1"], items["item-2"]]);
  });

  // Scenario: getChecklist funziona correttamente anche oltre il limite di 30 item
  it("resolves more than 30 itemIds in a single db.getAll batch read, without an 'in' query", async () => {
    const itemIds = Array.from({ length: 45 }, (_, i) => `item-${i + 1}`);
    const { db, getAllMock } = buildDb((...refs) =>
      refs.map((ref) => buildItemSnap(ref.id, { id: ref.id, title: ref.id, status: "Assegnare" }))
    );

    const result = await resolveChecklistItems(db, itemIds);

    expect(getAllMock).toHaveBeenCalledTimes(1);
    expect(getAllMock.mock.calls[0]).toHaveLength(45);
    expect(result).toHaveLength(45);
  });

  it("returns an empty array without calling db.getAll when there are no itemIds", async () => {
    const { db, getAllMock } = buildDb(() => []);

    const result = await resolveChecklistItems(db, []);

    expect(result).toEqual([]);
    expect(getAllMock).not.toHaveBeenCalled();
  });

  it("silently drops itemIds that no longer resolve to an existing checklistItems document", async () => {
    const { db } = buildDb((...refs) =>
      refs.map((ref) => (ref.id === "item-1" ? buildItemSnap(ref.id, { id: ref.id }) : buildItemSnap(ref.id, undefined)))
    );

    const result = await resolveChecklistItems(db, ["item-1", "missing-item"]);

    expect(result).toEqual([{ id: "item-1" }]);
  });
});
