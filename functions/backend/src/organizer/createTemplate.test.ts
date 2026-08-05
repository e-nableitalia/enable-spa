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
import { createTemplate } from "./createTemplate";

function buildRequest(data: Record<string, unknown>, uid: string | null = "user-1"): CallableRequest {
  return {
    auth: uid ? ({ uid, token: { email: "user@example.com" } } as CallableRequest["auth"]) : undefined,
    data,
    rawRequest: { headers: {} } as CallableRequest["rawRequest"],
  } as CallableRequest;
}

describe("createTemplate", () => {
  const GENERATED_ID = "generated-template-id";

  beforeEach(() => {
    jest.clearAllMocks();
    setMock.mockResolvedValue(undefined);
    docMock.mockReturnValue({ id: GENERATED_ID, set: setMock });
    collectionMock.mockReturnValue({ doc: docMock });
  });

  it("creates the templates/{templateId} document with category, title, items and createdAt", async () => {
    const items = [
      { title: "Prepara stampante", type: "boolean", quantity: 2 },
      { title: "Verifica materiale", type: "generic" },
    ];

    await createTemplate.run(
      buildRequest({ category: "devicetype-arto-superiore", title: "Template evento", items })
    );

    expect(collectionMock).toHaveBeenCalledWith("templates");
    expect(setMock).toHaveBeenCalledTimes(1);

    const [savedDocument] = setMock.mock.calls[0];
    expect(savedDocument).toEqual({
      category: "devicetype-arto-superiore",
      title: "Template evento",
      items: [
        { title: "Prepara stampante", type: "boolean", quantity: 2 },
        { title: "Verifica materiale", type: "generic", quantity: null },
      ],
      createdAt: SERVER_TIMESTAMP_SENTINEL,
    });
  });

  // Scenario 1: createTemplate con item type valido
  it.each(["boolean", "generic", "numeric"] as const)(
    "creates the item with the provided type '%s'",
    async (type) => {
      await createTemplate.run(
        buildRequest({
          category: "devicetype-mano",
          title: "Template mano",
          items: [{ title: "Verifica dita", type }],
        })
      );

      const [savedDocument] = setMock.mock.calls[0];
      expect(savedDocument.items[0].type).toBe(type);
    }
  );

  // Scenario 2: createTemplate con item senza type o non valido
  it("throws invalid-argument when an item has no type", async () => {
    await expect(
      createTemplate.run(
        buildRequest({
          category: "devicetype-mano",
          title: "Template mano",
          items: [{ title: "Verifica dita" }],
        })
      )
    ).rejects.toMatchObject(
      new HttpsError("invalid-argument", "Each item must have a valid type ('boolean' | 'generic' | 'numeric')")
    );

    expect(setMock).not.toHaveBeenCalled();
  });

  // Scenario 2: createTemplate con item senza type o non valido
  it("throws invalid-argument when an item has a type not among the 3 allowed", async () => {
    await expect(
      createTemplate.run(
        buildRequest({
          category: "devicetype-mano",
          title: "Template mano",
          items: [{ title: "Verifica dita", type: "unknown-type" }],
        })
      )
    ).rejects.toMatchObject(
      new HttpsError("invalid-argument", "Each item must have a valid type ('boolean' | 'generic' | 'numeric')")
    );

    expect(setMock).not.toHaveBeenCalled();
  });

  // Scenario: shorthand a stringa rimosso, un item-stringa è rifiutato a monte della validazione del type
  it("throws invalid-argument when an item is a bare string (no type)", async () => {
    await expect(
      createTemplate.run(
        buildRequest({
          category: "devicetype-mano",
          title: "Template mano",
          items: ["Verifica dita"],
        })
      )
    ).rejects.toMatchObject(
      new HttpsError("invalid-argument", "Each item must be a string or an object with a title")
    );

    expect(setMock).not.toHaveBeenCalled();
  });

  it("returns the generated templateId to the consumer", async () => {
    const result = await createTemplate.run(
      buildRequest({ category: "devicetype-mano", title: "Template mano", items: [] })
    );

    expect(result).toEqual({ templateId: GENERATED_ID });
  });

  it("throws unauthenticated when there is no auth context", async () => {
    await expect(
      createTemplate.run(buildRequest({ category: "devicetype-mano", title: "Template mano" }, null))
    ).rejects.toMatchObject(new HttpsError("unauthenticated", "Authentication required"));

    expect(setMock).not.toHaveBeenCalled();
  });

  it("throws invalid-argument when category is missing", async () => {
    await expect(
      createTemplate.run(buildRequest({ title: "Template senza categoria" }))
    ).rejects.toMatchObject(new HttpsError("invalid-argument", "Missing or invalid category"));

    expect(setMock).not.toHaveBeenCalled();
  });

  it("throws invalid-argument when title is missing", async () => {
    await expect(
      createTemplate.run(buildRequest({ category: "devicetype-mano" }))
    ).rejects.toMatchObject(new HttpsError("invalid-argument", "Missing or invalid title"));

    expect(setMock).not.toHaveBeenCalled();
  });

  it("logs a success security event when the template is created", async () => {
    await createTemplate.run(
      buildRequest({ category: "devicetype-mano", title: "Template mano", items: [] })
    );

    expect(logSecurityEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "create_template",
        outcome: "success",
        context: expect.objectContaining({ function: "createTemplate" }),
      })
    );
  });

  it("logs a failure security event when template creation fails validation", async () => {
    await expect(
      createTemplate.run(buildRequest({ title: "Template senza categoria" }))
    ).rejects.toBeInstanceOf(HttpsError);

    expect(logSecurityEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "create_template_failed",
        outcome: "failure",
        context: expect.objectContaining({ function: "createTemplate" }),
      })
    );
  });
});
