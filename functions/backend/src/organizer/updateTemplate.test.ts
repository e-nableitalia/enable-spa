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
  },
}));

jest.mock("../security/securityLog", () => ({
  logSecurityEvent: jest.fn().mockResolvedValue(undefined),
}));

import { logSecurityEvent } from "../security/securityLog";
import { updateTemplate } from "./updateTemplate";

function buildRequest(data: Record<string, unknown>, uid: string | null = "user-1"): CallableRequest {
  return {
    auth: uid ? ({ uid } as CallableRequest["auth"]) : undefined,
    data,
    rawRequest: { headers: {} } as CallableRequest["rawRequest"],
  } as CallableRequest;
}

describe("updateTemplate", () => {
  const TEMPLATE_ID = "existing-template-id";

  beforeEach(() => {
    jest.clearAllMocks();
    getMock.mockResolvedValue({ exists: true });
    updateMock.mockResolvedValue(undefined);
    docMock.mockReturnValue({ get: getMock, update: updateMock });
    collectionMock.mockReturnValue({ doc: docMock });
  });

  it("updates the title field on templates/{templateId} and sets updatedAt to the server timestamp", async () => {
    await updateTemplate.run(
      buildRequest({ templateId: TEMPLATE_ID, title: "Nuovo titolo" })
    );

    expect(collectionMock).toHaveBeenCalledWith("templates");
    expect(docMock).toHaveBeenCalledWith(TEMPLATE_ID);
    expect(updateMock).toHaveBeenCalledTimes(1);
    expect(updateMock).toHaveBeenCalledWith({
      title: "Nuovo titolo",
      updatedAt: SERVER_TIMESTAMP_SENTINEL,
    });
  });

  it("updates the items field, normalizing object items with their type, and sets updatedAt", async () => {
    await updateTemplate.run(
      buildRequest({
        templateId: TEMPLATE_ID,
        items: [
          { title: "Prepara stampante", type: "boolean" },
          { title: "Verifica materiale", type: "generic", quantity: 3 },
        ],
      })
    );

    expect(updateMock).toHaveBeenCalledWith({
      items: [
        { title: "Prepara stampante", type: "boolean", quantity: null },
        { title: "Verifica materiale", type: "generic", quantity: 3 },
      ],
      updatedAt: SERVER_TIMESTAMP_SENTINEL,
    });
  });

  it("updates both title and items together", async () => {
    await updateTemplate.run(
      buildRequest({
        templateId: TEMPLATE_ID,
        title: "Titolo aggiornato",
        items: [{ title: "Imballa dispositivo", type: "numeric", quantity: 1 }],
      })
    );

    expect(updateMock).toHaveBeenCalledWith({
      title: "Titolo aggiornato",
      items: [{ title: "Imballa dispositivo", type: "numeric", quantity: 1 }],
      updatedAt: SERVER_TIMESTAMP_SENTINEL,
    });
  });

  // Scenario 3: updateTemplate con item type valido
  it.each(["boolean", "generic", "numeric"] as const)(
    "updates the item with the provided type '%s'",
    async (type) => {
      await updateTemplate.run(
        buildRequest({
          templateId: TEMPLATE_ID,
          items: [{ title: "Verifica dita", type }],
        })
      );

      const [updatePayload] = updateMock.mock.calls[0];
      expect(updatePayload.items[0].type).toBe(type);
    }
  );

  // Scenario 4: updateTemplate con item senza type o non valido
  it("throws invalid-argument and does not update when an item in the new list has no type", async () => {
    await expect(
      updateTemplate.run(
        buildRequest({
          templateId: TEMPLATE_ID,
          items: [{ title: "Verifica dita" }],
        })
      )
    ).rejects.toMatchObject(
      new HttpsError("invalid-argument", "Each item must have a valid type ('boolean' | 'generic' | 'numeric')")
    );

    expect(updateMock).not.toHaveBeenCalled();
  });

  // Scenario 4: updateTemplate con item senza type o non valido
  it("throws invalid-argument and does not update when an item in the new list has a type not among the 3 allowed", async () => {
    await expect(
      updateTemplate.run(
        buildRequest({
          templateId: TEMPLATE_ID,
          items: [{ title: "Verifica dita", type: "unknown-type" }],
        })
      )
    ).rejects.toMatchObject(
      new HttpsError("invalid-argument", "Each item must have a valid type ('boolean' | 'generic' | 'numeric')")
    );

    expect(updateMock).not.toHaveBeenCalled();
  });

  // Scenario: shorthand a stringa rimosso, un item-stringa è rifiutato a monte della validazione del type
  it("throws invalid-argument and does not update when an item in the new list is a bare string (no type)", async () => {
    await expect(
      updateTemplate.run(
        buildRequest({
          templateId: TEMPLATE_ID,
          items: ["Verifica dita"],
        })
      )
    ).rejects.toMatchObject(
      new HttpsError("invalid-argument", "Each item must be a string or an object with a title")
    );

    expect(updateMock).not.toHaveBeenCalled();
  });

  it("returns the updated templateId to the consumer", async () => {
    const result = await updateTemplate.run(
      buildRequest({ templateId: TEMPLATE_ID, title: "Titolo aggiornato" })
    );

    expect(result).toEqual({ templateId: TEMPLATE_ID });
  });

  it("throws not-found and does not write when the template does not exist", async () => {
    getMock.mockResolvedValue({ exists: false });

    await expect(
      updateTemplate.run(buildRequest({ templateId: "missing-id", title: "Titolo" }))
    ).rejects.toMatchObject(new HttpsError("not-found", "Template not found"));

    expect(updateMock).not.toHaveBeenCalled();
  });

  it("throws unauthenticated when there is no auth context", async () => {
    await expect(
      updateTemplate.run(buildRequest({ templateId: TEMPLATE_ID, title: "Titolo" }, null))
    ).rejects.toMatchObject(new HttpsError("unauthenticated", "Authentication required"));

    expect(updateMock).not.toHaveBeenCalled();
  });

  it("throws invalid-argument when templateId is missing", async () => {
    await expect(
      updateTemplate.run(buildRequest({ title: "Titolo" }))
    ).rejects.toMatchObject(new HttpsError("invalid-argument", "Missing or invalid templateId"));

    expect(updateMock).not.toHaveBeenCalled();
  });

  it("throws invalid-argument when neither title nor items are provided", async () => {
    await expect(
      updateTemplate.run(buildRequest({ templateId: TEMPLATE_ID }))
    ).rejects.toMatchObject(
      new HttpsError("invalid-argument", "At least one of title or items must be provided")
    );

    expect(updateMock).not.toHaveBeenCalled();
  });

  it("throws invalid-argument when title is provided but invalid", async () => {
    await expect(
      updateTemplate.run(buildRequest({ templateId: TEMPLATE_ID, title: "   " }))
    ).rejects.toMatchObject(new HttpsError("invalid-argument", "Missing or invalid title"));

    expect(updateMock).not.toHaveBeenCalled();
  });

  it("throws invalid-argument when items is not an array", async () => {
    await expect(
      updateTemplate.run(buildRequest({ templateId: TEMPLATE_ID, items: "not-an-array" }))
    ).rejects.toMatchObject(new HttpsError("invalid-argument", "items must be an array"));

    expect(updateMock).not.toHaveBeenCalled();
  });

  it("throws invalid-argument when an item has no title", async () => {
    await expect(
      updateTemplate.run(buildRequest({ templateId: TEMPLATE_ID, items: [{ quantity: 1 }] }))
    ).rejects.toMatchObject(
      new HttpsError("invalid-argument", "Each item must have a non-empty title")
    );

    expect(updateMock).not.toHaveBeenCalled();
  });

  it("logs a success security event when the template is updated", async () => {
    await updateTemplate.run(buildRequest({ templateId: TEMPLATE_ID, title: "Nuovo titolo" }));

    expect(logSecurityEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "update_template",
        outcome: "success",
        context: expect.objectContaining({ function: "updateTemplate" }),
      })
    );
  });

  it("logs a failure security event when the template does not exist", async () => {
    getMock.mockResolvedValue({ exists: false });

    await expect(
      updateTemplate.run(buildRequest({ templateId: "missing-id", title: "Titolo" }))
    ).rejects.toBeInstanceOf(HttpsError);

    expect(logSecurityEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "update_template_failed",
        outcome: "failure",
        context: expect.objectContaining({ function: "updateTemplate" }),
      })
    );
  });
});
