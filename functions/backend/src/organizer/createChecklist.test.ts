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
      { title: "Prepara stampante", assignee: "user-1", quantity: 2, notes: "Nota" },
      { title: "Verifica materiale" },
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
          assignee: null,
          quantity: 2,
          notes: "Nota",
          status: "Assegnare",
          completed: false,
        },
        {
          id: expect.any(String),
          title: "Verifica materiale",
          assignee: null,
          quantity: null,
          notes: "",
          status: "Assegnare",
          completed: false,
        },
      ],
      createdAt: SERVER_TIMESTAMP_SENTINEL,
    });
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
});
