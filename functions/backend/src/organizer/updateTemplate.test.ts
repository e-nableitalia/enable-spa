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

  it("updates the items field, normalizing string and object items, and sets updatedAt", async () => {
    await updateTemplate.run(
      buildRequest({
        templateId: TEMPLATE_ID,
        items: ["Prepara stampante", { title: "Verifica materiale", quantity: 3 }],
      })
    );

    expect(updateMock).toHaveBeenCalledWith({
      items: [
        { title: "Prepara stampante", quantity: null },
        { title: "Verifica materiale", quantity: 3 },
      ],
      updatedAt: SERVER_TIMESTAMP_SENTINEL,
    });
  });

  it("updates both title and items together", async () => {
    await updateTemplate.run(
      buildRequest({
        templateId: TEMPLATE_ID,
        title: "Titolo aggiornato",
        items: [{ title: "Imballa dispositivo", quantity: 1 }],
      })
    );

    expect(updateMock).toHaveBeenCalledWith({
      title: "Titolo aggiornato",
      items: [{ title: "Imballa dispositivo", quantity: 1 }],
      updatedAt: SERVER_TIMESTAMP_SENTINEL,
    });
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
});
