import { HttpsError } from "firebase-functions/v2/https";
import type { CallableRequest } from "firebase-functions/v2/https";

const CHECKLIST_ID = "existing-checklist-id";

let documentExists = true;
let storedChecklist: Record<string, unknown> | undefined;

const getMock = jest.fn(() =>
  Promise.resolve({
    exists: documentExists,
    data: () => storedChecklist,
  })
);
const deleteMock = jest.fn(() => {
  documentExists = false;
  storedChecklist = undefined;
  return Promise.resolve();
});
const docMock = jest.fn((_id?: string) => ({ get: getMock, delete: deleteMock }));
const collectionMock = jest.fn(() => ({ doc: docMock }));

jest.mock("firebase-admin/firestore", () => ({
  getFirestore: jest.fn(() => ({ collection: collectionMock })),
}));

jest.mock("../security/securityLog", () => ({
  logSecurityEvent: jest.fn().mockResolvedValue(undefined),
}));

import { deleteChecklist } from "./deleteChecklist";

function buildRequest(data: Record<string, unknown>, uid: string | null = "user-1"): CallableRequest {
  return {
    auth: uid ? { uid, token: { email: "user@example.com" } } : undefined,
    data,
    rawRequest: { headers: {} } as CallableRequest["rawRequest"],
  } as CallableRequest;
}

/**
 * Riproduce, ai soli fini di questo test, il contratto di lettura previsto
 * per getChecklist (functions/backend/src/organizer/getChecklist.ts,
 * introdotto separatamente in EA-56 e non ancora presente in questa
 * codebase): restituisce i dati del documento se esiste, altrimenti
 * solleva un HttpsError "not-found". Serve a verificare che, dopo
 * l'eliminazione, una successiva lettura dello stesso checklistId non
 * trovi più il documento.
 */
async function readChecklistOrThrowNotFound(checklistId: string) {
  const snap = await docMock(checklistId).get();
  if (!snap.exists) {
    throw new HttpsError("not-found", "Checklist not found");
  }
  return snap.data();
}

describe("deleteChecklist", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    documentExists = true;
    storedChecklist = {
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
      createdAt: { seconds: 0, nanoseconds: 0 },
    };

    getMock.mockImplementation(() =>
      Promise.resolve({ exists: documentExists, data: () => storedChecklist })
    );
    deleteMock.mockImplementation(() => {
      documentExists = false;
      storedChecklist = undefined;
      return Promise.resolve();
    });
    docMock.mockReturnValue({ get: getMock, delete: deleteMock });
    collectionMock.mockReturnValue({ doc: docMock });
  });

  it("deletes the checklists/{checklistId} document (with its items) from Firestore", async () => {
    const result = await deleteChecklist.run(buildRequest({ checklistId: CHECKLIST_ID }));

    expect(collectionMock).toHaveBeenCalledWith("checklists");
    expect(docMock).toHaveBeenCalledWith(CHECKLIST_ID);
    expect(deleteMock).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ success: true });
  });

  it("makes a subsequent getChecklist on the same checklistId return not-found", async () => {
    await deleteChecklist.run(buildRequest({ checklistId: CHECKLIST_ID }));

    await expect(readChecklistOrThrowNotFound(CHECKLIST_ID)).rejects.toMatchObject(
      new HttpsError("not-found", "Checklist not found")
    );
  });

  it("throws not-found and does not call delete when the checklist does not exist", async () => {
    documentExists = false;
    storedChecklist = undefined;

    await expect(
      deleteChecklist.run(buildRequest({ checklistId: CHECKLIST_ID }))
    ).rejects.toMatchObject(new HttpsError("not-found", "Checklist not found"));

    expect(deleteMock).not.toHaveBeenCalled();
  });

  it("throws unauthenticated when there is no auth context", async () => {
    await expect(
      deleteChecklist.run(buildRequest({ checklistId: CHECKLIST_ID }, null))
    ).rejects.toMatchObject(new HttpsError("unauthenticated", "User must be authenticated"));

    expect(deleteMock).not.toHaveBeenCalled();
  });

  it("throws invalid-argument when checklistId is missing", async () => {
    await expect(deleteChecklist.run(buildRequest({}))).rejects.toMatchObject(
      new HttpsError("invalid-argument", "Missing checklistId")
    );

    expect(deleteMock).not.toHaveBeenCalled();
  });
});
