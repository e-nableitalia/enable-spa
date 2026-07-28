import { HttpsError } from "firebase-functions/v2/https";
import type { CallableRequest } from "firebase-functions/v2/https";

const SERVER_TIMESTAMP_SENTINEL = { __type: "serverTimestamp" };
const CHECKLIST_ID = "existing-checklist-id";
const GENERATED_CHECKLIST_ID = "generated-checklist-id";

/**
 * Store in-memory condiviso tra createChecklist e deleteChecklist: serve a
 * verificare che deleteChecklist legga davvero il campo `createdBy` scritto
 * da createChecklist, invece di mascherare il comportamento impostandolo a
 * mano sul mock (F-1).
 */
let checklistsStore: Record<string, Record<string, unknown> | undefined>;
let userRole: string | undefined;

const recursiveDeleteMock = jest.fn((ref: { id: string }) => {
  delete checklistsStore[ref.id];
  return Promise.resolve();
});

function buildChecklistDoc(id: string) {
  return {
    id,
    get: jest.fn(() =>
      Promise.resolve({
        exists: checklistsStore[id] !== undefined,
        data: () => checklistsStore[id],
      })
    ),
    set: jest.fn((data: Record<string, unknown>) => {
      checklistsStore[id] = data;
      return Promise.resolve();
    }),
  };
}

const checklistsDocMock = jest.fn((id?: string) => buildChecklistDoc(id ?? GENERATED_CHECKLIST_ID));
const userDocMock = jest.fn(() => ({
  get: jest.fn(() => Promise.resolve({ exists: true, data: () => ({ role: userRole }) })),
}));
const collectionMock = jest.fn((name: string) =>
  name === "users" ? { doc: userDocMock } : { doc: checklistsDocMock }
);

jest.mock("firebase-admin/firestore", () => ({
  getFirestore: jest.fn(() => ({
    collection: (name: string) => collectionMock(name),
    recursiveDelete: (ref: { id: string }) => recursiveDeleteMock(ref),
  })),
  FieldValue: {
    serverTimestamp: jest.fn(() => SERVER_TIMESTAMP_SENTINEL),
  },
}));

jest.mock("../security/securityLog", () => ({
  logSecurityEvent: jest.fn().mockResolvedValue(undefined),
}));

import { deleteChecklist } from "./deleteChecklist";
import { createChecklist } from "./createChecklist";

function buildRequest(data: Record<string, unknown>, uid: string | null = "user-1"): CallableRequest {
  return {
    auth: uid ? { uid, token: { email: "user@example.com" } } : undefined,
    data,
    rawRequest: { headers: {} } as CallableRequest["rawRequest"],
  } as CallableRequest;
}

async function readChecklistOrThrowNotFound(checklistId: string) {
  const snap = await checklistsDocMock(checklistId).get();
  if (!snap.exists) {
    throw new HttpsError("not-found", "Checklist not found");
  }
  return snap.data();
}

describe("deleteChecklist", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    checklistsStore = {};
    userRole = "admin";
  });

  it("deletes the checklists/{checklistId} document (with its items) from Firestore", async () => {
    checklistsStore[CHECKLIST_ID] = {
      category: "devicetype-arto-superiore",
      title: "Checklist evento",
      createdBy: "some-other-uid",
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
      ],
      createdAt: { seconds: 0, nanoseconds: 0 },
    };

    const result = await deleteChecklist.run(buildRequest({ checklistId: CHECKLIST_ID }));

    expect(collectionMock).toHaveBeenCalledWith("checklists");
    expect(checklistsDocMock).toHaveBeenCalledWith(CHECKLIST_ID);
    expect(recursiveDeleteMock).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ success: true });
  });

  it("makes a subsequent getChecklist on the same checklistId return not-found", async () => {
    checklistsStore[CHECKLIST_ID] = {
      category: "devicetype-arto-superiore",
      title: "Checklist evento",
      createdBy: "some-other-uid",
      items: [],
      createdAt: { seconds: 0, nanoseconds: 0 },
    };

    await deleteChecklist.run(buildRequest({ checklistId: CHECKLIST_ID }));

    await expect(readChecklistOrThrowNotFound(CHECKLIST_ID)).rejects.toMatchObject(
      new HttpsError("not-found", "Checklist not found")
    );
  });

  it("throws not-found and does not call delete when the checklist does not exist", async () => {
    await expect(
      deleteChecklist.run(buildRequest({ checklistId: CHECKLIST_ID }))
    ).rejects.toMatchObject(new HttpsError("not-found", "Checklist not found"));

    expect(recursiveDeleteMock).not.toHaveBeenCalled();
  });

  it("throws unauthenticated when there is no auth context", async () => {
    await expect(
      deleteChecklist.run(buildRequest({ checklistId: CHECKLIST_ID }, null))
    ).rejects.toMatchObject(new HttpsError("unauthenticated", "User must be authenticated"));

    expect(recursiveDeleteMock).not.toHaveBeenCalled();
  });

  it("throws invalid-argument when checklistId is missing", async () => {
    await expect(deleteChecklist.run(buildRequest({}))).rejects.toMatchObject(
      new HttpsError("invalid-argument", "Missing checklistId")
    );

    expect(recursiveDeleteMock).not.toHaveBeenCalled();
  });

  describe("creator authorization (F-1: createdBy is now written by the creation functions)", () => {
    it("allows the creator of the checklist, as recorded by createChecklist, to delete it even without an admin role", async () => {
      userRole = "volunteer";

      const { checklistId } = await createChecklist.run(
        buildRequest(
          { category: "devicetype-mano", title: "Checklist evento", items: [] },
          "creator-uid"
        )
      );
      expect(checklistsStore[checklistId]?.createdBy).toBe("creator-uid");

      const result = await deleteChecklist.run(buildRequest({ checklistId }, "creator-uid"));

      expect(result).toEqual({ success: true });
    });

    it("throws permission-denied when a non-admin, non-creator user tries to delete another user's checklist", async () => {
      userRole = "volunteer";

      const { checklistId } = await createChecklist.run(
        buildRequest(
          { category: "devicetype-mano", title: "Checklist evento", items: [] },
          "creator-uid"
        )
      );

      await expect(
        deleteChecklist.run(buildRequest({ checklistId }, "other-uid"))
      ).rejects.toMatchObject(
        new HttpsError("permission-denied", "Cannot delete another user's checklist")
      );

      expect(recursiveDeleteMock).not.toHaveBeenCalled();
    });
  });
});
