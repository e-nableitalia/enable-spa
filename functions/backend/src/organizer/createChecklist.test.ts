import { HttpsError } from "firebase-functions/v2/https";
import type { CallableRequest } from "firebase-functions/v2/https";

const SERVER_TIMESTAMP_SENTINEL = { __type: "serverTimestamp" };

const batchSetMock = jest.fn();
const batchCommitMock = jest.fn().mockResolvedValue(undefined);
const collectionMock = jest.fn();

let checklistDocCounter = 0;
let checklistItemDocCounter = 0;

function checklistsDoc() {
  checklistDocCounter += 1;
  return { id: `generated-checklist-id-${checklistDocCounter}` };
}

function checklistItemsDoc() {
  checklistItemDocCounter += 1;
  return { id: `generated-item-id-${checklistItemDocCounter}` };
}

jest.mock("firebase-admin/firestore", () => ({
  getFirestore: jest.fn(() => ({
    collection: collectionMock,
    batch: jest.fn(() => ({
      set: batchSetMock,
      commit: batchCommitMock,
    })),
  })),
  FieldValue: {
    serverTimestamp: jest.fn(() => SERVER_TIMESTAMP_SENTINEL),
  },
}));

jest.mock("../security/securityLog", () => ({
  logSecurityEvent: jest.fn().mockResolvedValue(undefined),
}));

import { logSecurityEvent } from "../security/securityLog";
import { createChecklist } from "./createChecklist";

function buildRequest(data: Record<string, unknown>): CallableRequest {
  return {
    auth: { uid: "user-1", token: { email: "user@example.com" } } as CallableRequest["auth"],
    data,
    rawRequest: { headers: {} } as CallableRequest["rawRequest"],
  } as CallableRequest;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function batchSetCallFor(id: string): [{ id: string }, any] {
  const call = batchSetMock.mock.calls.find(([ref]) => ref.id === id);
  if (!call) {
    throw new Error(`No batch.set call found for document id ${id}`);
  }
  return call;
}

describe("createChecklist", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    checklistDocCounter = 0;
    checklistItemDocCounter = 0;
    batchCommitMock.mockResolvedValue(undefined);
    collectionMock.mockImplementation((name: string) => ({
      doc: jest.fn(() => (name === "checklists" ? checklistsDoc() : checklistItemsDoc())),
    }));
  });

  // Scenario: createChecklist scrive gli item come documenti separati con category denormalizzata
  it("writes each initial item as a distinct checklistItems document, referencing the new checklist and its category", async () => {
    const items = [
      { title: "Prepara stampante", type: "boolean", assignee: "user-1", quantity: 2, notes: "Nota" },
      { title: "Verifica materiale", type: "generic" },
    ];

    const result = await createChecklist.run(
      buildRequest({ category: "devicetype-arto-superiore", title: "Checklist evento", items })
    );

    expect(collectionMock).toHaveBeenCalledWith("checklists");
    expect(collectionMock).toHaveBeenCalledWith("checklistItems");
    expect(batchSetMock).toHaveBeenCalledTimes(3); // 1 checklist + 2 item
    expect(batchCommitMock).toHaveBeenCalledTimes(1);

    const checklistId = (result as { checklistId: string }).checklistId;
    const [, checklistDocument] = batchSetCallFor(checklistId);
    expect(checklistDocument.items).toHaveLength(2);
    expect(checklistDocument.items.every((id: unknown) => typeof id === "string")).toBe(true);

    for (const itemId of checklistDocument.items as string[]) {
      const [, itemDocument] = batchSetCallFor(itemId);
      expect(itemDocument.checklistId).toBe(checklistId);
      expect(itemDocument.category).toBe("devicetype-arto-superiore");
      expect(itemDocument.id).toBe(itemId);
    }

    const firstItemId = checklistDocument.items[0] as string;
    const [, firstItemDocument] = batchSetCallFor(firstItemId);
    expect(firstItemDocument).toEqual({
      id: firstItemId,
      checklistId,
      category: "devicetype-arto-superiore",
      title: "Prepara stampante",
      type: "boolean",
      assignee: null,
      quantity: 2,
      notes: "Nota",
      status: "Assegnare",
      completed: false,
      creationDate: SERVER_TIMESTAMP_SENTINEL,
      dueDate: null,
      completionDate: null,
    });
  });

  // Scenario: createChecklist scrive gli item come documenti separati con category denormalizzata
  it("stores only the item ids (not the full item objects) on checklists/{id}.items", async () => {
    const result = await createChecklist.run(
      buildRequest({
        category: "devicetype-mano",
        title: "Checklist mano",
        items: [{ title: "Verifica dita", type: "generic" }],
      })
    );

    const checklistId = (result as { checklistId: string }).checklistId;
    const [, checklistDocument] = batchSetCallFor(checklistId);

    expect(checklistDocument.items).toEqual([expect.any(String)]);
    expect(checklistDocument.items[0]).not.toHaveProperty("title");
  });

  // Scenario 1: item iniziale con type valido
  it.each(["boolean", "generic", "numeric"] as const)(
    "creates the item with the provided type '%s'",
    async (type) => {
      const result = await createChecklist.run(
        buildRequest({
          category: "devicetype-mano",
          title: "Checklist mano",
          items: [{ title: "Verifica dita", type }],
        })
      );

      const checklistId = (result as { checklistId: string }).checklistId;
      const [, checklistDocument] = batchSetCallFor(checklistId);
      const [, itemDocument] = batchSetCallFor(checklistDocument.items[0]);
      expect(itemDocument.type).toBe(type);
    }
  );

  // Scenario 2: item iniziale senza type o con type non valido
  it("throws invalid-argument when an initial item has no type", async () => {
    await expect(
      createChecklist.run(
        buildRequest({
          category: "devicetype-mano",
          title: "Checklist mano",
          items: [{ title: "Verifica dita" }],
        })
      )
    ).rejects.toMatchObject(
      new HttpsError("invalid-argument", "Each item must have a valid type ('boolean' | 'generic' | 'numeric')")
    );

    expect(batchCommitMock).not.toHaveBeenCalled();
  });

  // Scenario 2: item iniziale senza type o con type non valido
  it("throws invalid-argument when an initial item has a type not among the 3 allowed", async () => {
    await expect(
      createChecklist.run(
        buildRequest({
          category: "devicetype-mano",
          title: "Checklist mano",
          items: [{ title: "Verifica dita", type: "unknown-type" }],
        })
      )
    ).rejects.toMatchObject(
      new HttpsError("invalid-argument", "Each item must have a valid type ('boolean' | 'generic' | 'numeric')")
    );

    expect(batchCommitMock).not.toHaveBeenCalled();
  });

  // Scenario 2: anche lo shorthand a stringa non porta un type esplicito, quindi è rifiutato
  it("throws invalid-argument when an initial item is a bare string (no type)", async () => {
    await expect(
      createChecklist.run(
        buildRequest({
          category: "devicetype-mano",
          title: "Checklist mano",
          items: ["Verifica dita"],
        })
      )
    ).rejects.toMatchObject(
      new HttpsError("invalid-argument", "Each item must have a valid type ('boolean' | 'generic' | 'numeric')")
    );

    expect(batchCommitMock).not.toHaveBeenCalled();
  });

  it("writes createdBy with the authenticated caller's uid", async () => {
    const result = await createChecklist.run(
      buildRequest({ category: "devicetype-mano", title: "Checklist mano", items: [] })
    );

    const checklistId = (result as { checklistId: string }).checklistId;
    const [, checklistDocument] = batchSetCallFor(checklistId);
    expect(checklistDocument.createdBy).toBe("user-1");
  });

  it("returns the generated checklistId to the consumer", async () => {
    const result = await createChecklist.run(
      buildRequest({ category: "devicetype-mano", title: "Checklist mano", items: [] })
    );

    expect(result).toEqual({ checklistId: expect.any(String) });
  });

  it("defaults items to an empty array when not provided", async () => {
    const result = await createChecklist.run(
      buildRequest({ category: "devicetype-mano", title: "Checklist mano" })
    );

    const checklistId = (result as { checklistId: string }).checklistId;
    const [, checklistDocument] = batchSetCallFor(checklistId);
    expect(checklistDocument.items).toEqual([]);
    expect(batchSetMock).toHaveBeenCalledTimes(1); // only the checklist document
  });

  it("throws invalid-argument when category is missing", async () => {
    await expect(
      createChecklist.run(buildRequest({ title: "Checklist senza categoria" }))
    ).rejects.toMatchObject(new HttpsError("invalid-argument", "Missing or invalid category"));

    expect(batchCommitMock).not.toHaveBeenCalled();
  });

  it("throws invalid-argument when title is missing", async () => {
    await expect(
      createChecklist.run(buildRequest({ category: "devicetype-mano" }))
    ).rejects.toMatchObject(new HttpsError("invalid-argument", "Missing or invalid title"));

    expect(batchCommitMock).not.toHaveBeenCalled();
  });

  it("logs a success security event when the checklist is created", async () => {
    await createChecklist.run(
      buildRequest({ category: "devicetype-mano", title: "Checklist mano", items: [] })
    );

    expect(logSecurityEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "create_checklist",
        outcome: "success",
        context: expect.objectContaining({ function: "createChecklist" }),
      })
    );
  });

  it("logs a failure security event when checklist creation fails validation", async () => {
    await expect(
      createChecklist.run(buildRequest({ title: "Checklist senza categoria" }))
    ).rejects.toBeInstanceOf(HttpsError);

    expect(logSecurityEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "create_checklist_failed",
        outcome: "failure",
        context: expect.objectContaining({ function: "createChecklist" }),
      })
    );
  });

  // Scenario: createChecklist salva origin quando fornito, lo omette quando assente
  it("writes the origin field with the exact value provided by the consumer", async () => {
    const result = await createChecklist.run(
      buildRequest({
        category: "devicetype-mano",
        title: "Checklist mano",
        items: [],
        origin: { type: "deviceRequest", id: "request-42" },
      })
    );

    const checklistId = (result as { checklistId: string }).checklistId;
    const [, checklistDocument] = batchSetCallFor(checklistId);
    expect(checklistDocument.origin).toEqual({ type: "deviceRequest", id: "request-42" });
  });

  // Scenario: createChecklist salva origin quando fornito, lo omette quando assente
  it("does not write an origin field when origin is not provided", async () => {
    const result = await createChecklist.run(
      buildRequest({ category: "devicetype-mano", title: "Checklist mano", items: [] })
    );

    const checklistId = (result as { checklistId: string }).checklistId;
    const [, checklistDocument] = batchSetCallFor(checklistId);
    expect(checklistDocument).not.toHaveProperty("origin");
  });

  // Scenario: createChecklist salva origin quando fornito, lo omette quando assente
  it("throws invalid-argument when origin is provided but malformed", async () => {
    await expect(
      createChecklist.run(
        buildRequest({
          category: "devicetype-mano",
          title: "Checklist mano",
          items: [],
          origin: { type: "deviceRequest" },
        })
      )
    ).rejects.toMatchObject(new HttpsError("invalid-argument", "origin must be an object with type and id"));

    expect(batchCommitMock).not.toHaveBeenCalled();
  });
});
