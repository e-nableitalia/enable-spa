import { HttpsError } from "firebase-functions/v2/https";
import type { CallableRequest } from "firebase-functions/v2/https";

const CHECKLIST_ID = "checklist-1";
const TOKEN = "project-share-token-1";

let shareLinksStore: Record<string, Record<string, unknown> | undefined>;
let checklistsStore: Record<string, Record<string, unknown> | undefined>;
let checklistItemsStore: Record<string, Record<string, unknown> | undefined>;
let projectsStore: Record<string, Record<string, unknown> | undefined>;

function buildCollection(name: string) {
  if (name === "projectChecklistShareLinks") {
    return {
      doc: jest.fn((token: string) => ({
        get: jest.fn(() =>
          Promise.resolve({
            exists: shareLinksStore[token] !== undefined,
            data: () => shareLinksStore[token],
          })
        ),
      })),
    };
  }

  if (name === "projects") {
    return {
      doc: jest.fn((id: string) => ({
        get: jest.fn(() =>
          Promise.resolve({
            exists: projectsStore[id] !== undefined,
            data: () => projectsStore[id],
          })
        ),
      })),
    };
  }

  if (name === "checklists") {
    return {
      doc: jest.fn((id: string) => ({
        get: jest.fn(() =>
          Promise.resolve({
            exists: checklistsStore[id] !== undefined,
            data: () => checklistsStore[id],
          })
        ),
      })),
    };
  }

  if (name === "checklistItems") {
    return {
      doc: jest.fn((id: string) => ({ id, __kind: "checklistItemRef" as const })),
    };
  }

  throw new Error(`Unexpected collection ${name}`);
}

const collectionMock = jest.fn((name: string) => buildCollection(name));
const getAllMock = jest.fn((...refs: { id: string }[]) =>
  Promise.resolve(
    refs.map((ref) => ({
      exists: checklistItemsStore[ref.id] !== undefined,
      data: () => checklistItemsStore[ref.id],
    }))
  )
);

jest.mock("firebase-admin/firestore", () => ({
  getFirestore: jest.fn(() => ({
    collection: (name: string) => collectionMock(name),
    getAll: (...refs: { id: string }[]) => getAllMock(...refs),
  })),
}));

jest.mock("../security/securityLog", () => ({
  logSecurityEvent: jest.fn().mockResolvedValue(undefined),
}));

import { getProjectChecklistShareStatus } from "./getProjectChecklistShareStatus";

function buildRequest(data: Record<string, unknown>): CallableRequest {
  return {
    auth: undefined,
    data,
    rawRequest: { ip: "203.0.113.5", headers: {} } as unknown as CallableRequest["rawRequest"],
  } as CallableRequest;
}

describe("getProjectChecklistShareStatus", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    shareLinksStore = {
      [TOKEN]: {
        checklistId: CHECKLIST_ID,
        projectId: "project-1",
      },
    };
    checklistsStore = {};
    checklistItemsStore = {};
    projectsStore = {};
  });

  it("returns percentComplete, projectTitle and simplified items for anonymous requests", async () => {
    checklistsStore = {
      [CHECKLIST_ID]: { items: ["item-1", "item-2"] },
    };
    checklistItemsStore = {
      "item-1": { title: "Task 1", status: "Completata" },
      "item-2": { title: "Task 2", status: "Assegnare" },
    };
    projectsStore = {
      "project-1": { title: "Progetto pilota", status: "active", projectType: "evento", checklists: [] },
    };

    const result = await getProjectChecklistShareStatus.run(buildRequest({ token: TOKEN }));

    expect(result).toEqual({
      percentComplete: 50,
      projectTitle: "Progetto pilota",
      items: [
        { title: "Task 1", completed: true },
        { title: "Task 2", completed: false },
      ],
    });
  });

  it("returns null projectTitle when project cannot be resolved", async () => {
    checklistsStore = { [CHECKLIST_ID]: { items: [] } };

    const result = await getProjectChecklistShareStatus.run(buildRequest({ token: TOKEN }));
    expect(result).toEqual({ percentComplete: 100, items: [], projectTitle: null });
  });

  it("throws not-found for unknown tokens", async () => {
    await expect(
      getProjectChecklistShareStatus.run(buildRequest({ token: "unknown-token" }))
    ).rejects.toMatchObject(new HttpsError("not-found", "Share link not found"));
  });
});
