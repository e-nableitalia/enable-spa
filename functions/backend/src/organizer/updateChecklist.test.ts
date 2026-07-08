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

import { updateChecklist } from "./updateChecklist";

function buildRequest(data: Record<string, unknown>): CallableRequest {
  return {
    auth: { uid: "user-1" } as CallableRequest["auth"],
    data,
    rawRequest: { headers: {} } as CallableRequest["rawRequest"],
  } as CallableRequest;
}

describe("updateChecklist", () => {
  const CHECKLIST_ID = "existing-checklist-id";

  beforeEach(() => {
    jest.clearAllMocks();
    getMock.mockResolvedValue({ exists: true });
    updateMock.mockResolvedValue(undefined);
    docMock.mockReturnValue({ get: getMock, update: updateMock });
    collectionMock.mockReturnValue({ doc: docMock });
  });

  it("updates the title field on checklists/{checklistId} and sets updatedAt to the server timestamp", async () => {
    await updateChecklist.run(
      buildRequest({ checklistId: CHECKLIST_ID, title: "Nuovo titolo" })
    );

    expect(collectionMock).toHaveBeenCalledWith("checklists");
    expect(docMock).toHaveBeenCalledWith(CHECKLIST_ID);
    expect(updateMock).toHaveBeenCalledTimes(1);
    expect(updateMock).toHaveBeenCalledWith({
      title: "Nuovo titolo",
      updatedAt: SERVER_TIMESTAMP_SENTINEL,
    });
  });

  it("returns the updated checklistId and title to the consumer", async () => {
    const result = await updateChecklist.run(
      buildRequest({ checklistId: CHECKLIST_ID, title: "Titolo aggiornato" })
    );

    expect(result).toEqual({ checklistId: CHECKLIST_ID, title: "Titolo aggiornato" });
  });

  it("throws not-found and does not write when the checklist does not exist", async () => {
    getMock.mockResolvedValue({ exists: false });

    await expect(
      updateChecklist.run(buildRequest({ checklistId: "missing-id", title: "Titolo" }))
    ).rejects.toMatchObject(new HttpsError("not-found", "Checklist not found"));

    expect(updateMock).not.toHaveBeenCalled();
  });

  it("throws unauthenticated when the caller is not authenticated", async () => {
    await expect(
      updateChecklist.run({
        auth: undefined,
        data: { checklistId: CHECKLIST_ID, title: "Titolo" },
        rawRequest: { headers: {} },
      } as CallableRequest)
    ).rejects.toMatchObject(new HttpsError("unauthenticated", "User must be authenticated"));

    expect(updateMock).not.toHaveBeenCalled();
  });

  it("throws invalid-argument when checklistId is missing", async () => {
    await expect(
      updateChecklist.run(buildRequest({ title: "Titolo" }))
    ).rejects.toMatchObject(new HttpsError("invalid-argument", "Missing parameter: checklistId"));

    expect(updateMock).not.toHaveBeenCalled();
  });

  it("throws invalid-argument when title is missing", async () => {
    await expect(
      updateChecklist.run(buildRequest({ checklistId: CHECKLIST_ID }))
    ).rejects.toMatchObject(new HttpsError("invalid-argument", "Missing or invalid title"));

    expect(updateMock).not.toHaveBeenCalled();
  });
});
