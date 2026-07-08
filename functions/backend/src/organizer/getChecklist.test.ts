import { HttpsError } from "firebase-functions/v2/https";
import type { CallableRequest } from "firebase-functions/v2/https";

const CHECKLIST_ID = "existing-checklist-id";

const getMock = jest.fn();
const docMock = jest.fn();
const collectionMock = jest.fn();

jest.mock("firebase-admin/firestore", () => ({
  getFirestore: jest.fn(() => ({
    collection: collectionMock,
  })),
}));

import { getChecklist } from "./getChecklist";

function buildRequest(data: Record<string, unknown>, uid: string | null = "user-1"): CallableRequest {
  return {
    auth: uid ? ({ uid } as CallableRequest["auth"]) : undefined,
    data,
    rawRequest: { headers: {} } as CallableRequest["rawRequest"],
  } as CallableRequest;
}

describe("getChecklist", () => {
  const storedChecklist = {
    category: "devicetype-arto-superiore",
    title: "Checklist evento",
    items: [
      {
        id: "item-1",
        title: "Prepara stampante",
        assignee: null,
        quantity: 2,
        notes: "",
        status: "Assegnare",
        completed: false,
      },
      {
        id: "item-2",
        title: "Verifica materiale",
        assignee: null,
        quantity: null,
        notes: "",
        status: "Assegnare",
        completed: false,
      },
    ],
    createdAt: { seconds: 1, nanoseconds: 0 },
    updatedAt: { seconds: 2, nanoseconds: 0 },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    getMock.mockResolvedValue({ exists: true, data: () => storedChecklist });
    docMock.mockReturnValue({ get: getMock });
    collectionMock.mockReturnValue({ doc: docMock });
  });

  it("returns the full checklist document when the checklistId exists", async () => {
    const result = await getChecklist.run(buildRequest({ checklistId: CHECKLIST_ID }));

    expect(collectionMock).toHaveBeenCalledWith("checklists");
    expect(docMock).toHaveBeenCalledWith(CHECKLIST_ID);
    expect(getMock).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      category: storedChecklist.category,
      title: storedChecklist.title,
      items: storedChecklist.items,
      createdAt: storedChecklist.createdAt,
      updatedAt: storedChecklist.updatedAt,
    });
  });

  it("throws not-found when the checklist does not exist", async () => {
    getMock.mockResolvedValue({ exists: false, data: () => undefined });

    await expect(
      getChecklist.run(buildRequest({ checklistId: "missing-id" }))
    ).rejects.toMatchObject(new HttpsError("not-found", "Checklist not found"));
  });

  it("throws unauthenticated when there is no auth context", async () => {
    await expect(
      getChecklist.run(buildRequest({ checklistId: CHECKLIST_ID }, null))
    ).rejects.toMatchObject(new HttpsError("unauthenticated", "User must be authenticated"));

    expect(getMock).not.toHaveBeenCalled();
  });

  it("throws invalid-argument when checklistId is missing", async () => {
    await expect(getChecklist.run(buildRequest({}))).rejects.toMatchObject(
      new HttpsError("invalid-argument", "Missing parameter: checklistId")
    );

    expect(getMock).not.toHaveBeenCalled();
  });
});
