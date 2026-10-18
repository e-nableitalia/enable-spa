import { HttpsError } from "firebase-functions/v2/https";
import type { CallableRequest } from "firebase-functions/v2/https";

const CHECKLIST_ID = "checklist-1";
const GENERATED_TOKEN = "project-share-token-uuid";

jest.mock("crypto", () => ({
  ...jest.requireActual("crypto"),
  randomUUID: jest.fn(() => GENERATED_TOKEN),
}));

let usersStore: Record<string, Record<string, unknown> | undefined>;
let projectsStore: Record<string, Record<string, unknown> | undefined>;
let shareLinksStore: Record<string, Record<string, unknown> | undefined>;

const shareLinkSetMock = jest.fn((token: string, doc: Record<string, unknown>) => {
  shareLinksStore[token] = doc;
  return Promise.resolve();
});

function buildCollection(name: string) {
  if (name === "users") {
    return {
      doc: jest.fn((uid: string) => ({
        get: jest.fn(() =>
          Promise.resolve({
            exists: usersStore[uid] !== undefined,
            data: () => usersStore[uid],
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

  if (name === "projectChecklistShareLinks") {
    return {
      doc: jest.fn((token: string) => ({
        set: jest.fn((doc: Record<string, unknown>) => shareLinkSetMock(token, doc)),
      })),
      where: jest.fn((field: string, _op: string, value: unknown) => ({
        limit: jest.fn(() => ({
          get: jest.fn(() => {
            const matches = Object.entries(shareLinksStore).filter(
              ([, data]) => data !== undefined && (data as Record<string, unknown>)[field] === value
            );
            return Promise.resolve({
              empty: matches.length === 0,
              docs: matches.map(([id, data]) => ({ id, data: () => data })),
            });
          }),
        })),
      })),
    };
  }

  throw new Error(`Unexpected collection ${name}`);
}

const collectionMock = jest.fn((name: string) => buildCollection(name));

jest.mock("firebase-admin/firestore", () => ({
  getFirestore: jest.fn(() => ({
    collection: (name: string) => collectionMock(name),
  })),
  FieldValue: { serverTimestamp: jest.fn(() => "SERVER_TIMESTAMP") },
}));

jest.mock("../security/securityLog", () => ({
  logSecurityEvent: jest.fn().mockResolvedValue(undefined),
}));

import { createProjectChecklistShareLink } from "./createProjectChecklistShareLink";

function buildRequest(data: Record<string, unknown>, uid: string | null = "admin-1"): CallableRequest {
  return {
    auth: uid ? ({ uid } as CallableRequest["auth"]) : undefined,
    data,
    rawRequest: { headers: {} } as CallableRequest["rawRequest"],
  } as CallableRequest;
}

describe("createProjectChecklistShareLink", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    shareLinksStore = {};

    usersStore = {
      "admin-1": { role: "admin" },
      "volunteer-1": { role: "volunteer", active: true },
      "guest-1": { role: "guest" },
    };

    projectsStore = {
      "project-1": {
        title: "Progetto test",
        projectType: "evento",
        status: "active",
        createdBy: "admin-1",
        checklists: [{ checklistId: CHECKLIST_ID, label: "Fase 1" }],
      },
    };
  });

  it("creates a persisted token linked to project checklist and returns public URL", async () => {
    const result = await createProjectChecklistShareLink.run(
      buildRequest({ projectId: "project-1", checklistId: CHECKLIST_ID }, "admin-1")
    );

    expect(result).toEqual({
      token: GENERATED_TOKEN,
      url: `https://app.e-nableitalia.it/project-checklist-share/${GENERATED_TOKEN}`,
    });
    expect(shareLinkSetMock).toHaveBeenCalledWith(
      GENERATED_TOKEN,
      expect.objectContaining({ projectId: "project-1", checklistId: CHECKLIST_ID, createdBy: "admin-1" })
    );
  });

  it("allows volunteers to generate the link", async () => {
    const result = await createProjectChecklistShareLink.run(
      buildRequest({ projectId: "project-1", checklistId: CHECKLIST_ID }, "volunteer-1")
    );

    expect(result.token).toBe(GENERATED_TOKEN);
    expect(shareLinkSetMock).toHaveBeenCalled();
  });

  it("reuses existing token for the same checklist", async () => {
    shareLinksStore = {
      "existing-project-token": { projectId: "project-1", checklistId: CHECKLIST_ID },
    };

    const result = await createProjectChecklistShareLink.run(
      buildRequest({ projectId: "project-1", checklistId: CHECKLIST_ID }, "admin-1")
    );

    expect(result).toEqual({
      token: "existing-project-token",
      url: "https://app.e-nableitalia.it/project-checklist-share/existing-project-token",
    });
    expect(shareLinkSetMock).not.toHaveBeenCalled();
  });

  it("denies non-staff users", async () => {
    await expect(
      createProjectChecklistShareLink.run(
        buildRequest({ projectId: "project-1", checklistId: CHECKLIST_ID }, "guest-1")
      )
    ).rejects.toMatchObject(new HttpsError("permission-denied", "Only admin or volunteers can access projects"));
  });

  it("throws not-found when checklist does not belong to project", async () => {
    await expect(
      createProjectChecklistShareLink.run(
        buildRequest({ projectId: "project-1", checklistId: "other-checklist" }, "admin-1")
      )
    ).rejects.toMatchObject(new HttpsError("not-found", "Checklist not linked to this project"));
  });
});
