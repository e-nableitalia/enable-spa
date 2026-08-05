import { HttpsError } from "firebase-functions/v2/https";
import type { CallableRequest } from "firebase-functions/v2/https";

const SERVER_TIMESTAMP_SENTINEL = { __type: "serverTimestamp" };

const setMock = jest.fn().mockResolvedValue(undefined);
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

import { logSecurityEvent } from "../security/securityLog";
import { createChecklist } from "./createChecklist";

function buildRequest(data: Record<string, unknown>): CallableRequest {
  return {
    auth: { uid: "user-1", token: { email: "user@example.com" } } as CallableRequest["auth"],
    data,
    rawRequest: { headers: {} } as CallableRequest["rawRequest"],
  } as CallableRequest;
}

describe("createChecklist", () => {
  const GENERATED_ID = "generated-checklist-id";

  beforeEach(() => {
    jest.clearAllMocks();
    setMock.mockResolvedValue(undefined);
    docMock.mockReturnValue({ id: GENERATED_ID, set: setMock });
    collectionMock.mockReturnValue({ doc: docMock });
  });

  it("creates the checklists/{checklistId} document with category, title, items and createdAt", async () => {
    const items = [
      { title: "Prepara stampante", type: "boolean", assignee: "user-1", quantity: 2, notes: "Nota" },
      { title: "Verifica materiale", type: "generic" },
    ];

    await createChecklist.run(
      buildRequest({ category: "devicetype-arto-superiore", title: "Checklist evento", items })
    );

    expect(collectionMock).toHaveBeenCalledWith("checklists");
    expect(docMock).toHaveBeenCalledWith();
    expect(setMock).toHaveBeenCalledTimes(1);

    const [savedDocument] = setMock.mock.calls[0];
    expect(savedDocument).toEqual({
      category: "devicetype-arto-superiore",
      title: "Checklist evento",
      items: [
        {
          id: expect.any(String),
          title: "Prepara stampante",
          type: "boolean",
          assignee: null,
          quantity: 2,
          notes: "Nota",
          status: "Assegnare",
          completed: false,
        },
        {
          id: expect.any(String),
          title: "Verifica materiale",
          type: "generic",
          assignee: null,
          quantity: null,
          notes: "",
          status: "Assegnare",
          completed: false,
        },
      ],
      createdBy: "user-1",
      createdAt: SERVER_TIMESTAMP_SENTINEL,
    });
  });

  // Scenario 1: item iniziale con type valido
  it.each(["boolean", "generic", "numeric"] as const)(
    "creates the item with the provided type '%s'",
    async (type) => {
      await createChecklist.run(
        buildRequest({
          category: "devicetype-mano",
          title: "Checklist mano",
          items: [{ title: "Verifica dita", type }],
        })
      );

      const [savedDocument] = setMock.mock.calls[0];
      expect(savedDocument.items[0].type).toBe(type);
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

    expect(setMock).not.toHaveBeenCalled();
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

    expect(setMock).not.toHaveBeenCalled();
  });

  // Scenario: lo shorthand a stringa è stato rimosso, l'input cade nel ramo else
  it("throws invalid-argument when an initial item is a bare string (shorthand removed)", async () => {
    await expect(
      createChecklist.run(
        buildRequest({
          category: "devicetype-mano",
          title: "Checklist mano",
          items: ["Verifica dita"],
        })
      )
    ).rejects.toMatchObject(
      new HttpsError("invalid-argument", "Each item must be a string or an object with a title")
    );

    expect(setMock).not.toHaveBeenCalled();
  });

  it("writes createdBy with the authenticated caller's uid", async () => {
    await createChecklist.run(
      buildRequest({ category: "devicetype-mano", title: "Checklist mano", items: [] })
    );

    const [savedDocument] = setMock.mock.calls[0];
    expect(savedDocument.createdBy).toBe("user-1");
  });

  it("returns the generated checklistId to the consumer", async () => {
    const result = await createChecklist.run(
      buildRequest({ category: "devicetype-mano", title: "Checklist mano", items: [] })
    );

    expect(result).toEqual({ checklistId: GENERATED_ID });
  });

  it("defaults items to an empty array when not provided", async () => {
    await createChecklist.run(buildRequest({ category: "devicetype-mano", title: "Checklist mano" }));

    const [savedDocument] = setMock.mock.calls[0];
    expect(savedDocument.items).toEqual([]);
  });

  it("throws invalid-argument when category is missing", async () => {
    await expect(
      createChecklist.run(buildRequest({ title: "Checklist senza categoria" }))
    ).rejects.toMatchObject(new HttpsError("invalid-argument", "Missing or invalid category"));

    expect(setMock).not.toHaveBeenCalled();
  });

  it("throws invalid-argument when title is missing", async () => {
    await expect(
      createChecklist.run(buildRequest({ category: "devicetype-mano" }))
    ).rejects.toMatchObject(new HttpsError("invalid-argument", "Missing or invalid title"));

    expect(setMock).not.toHaveBeenCalled();
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
});
