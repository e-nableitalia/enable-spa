import { HttpsError } from "firebase-functions/v2/https";
import {
  usersStore,
  projectsStore,
  eventsStore,
  firestoreMockModule,
  buildRequest,
  resetProjectsTestSupport,
} from "./testSupport";

jest.mock("firebase-admin/firestore", () => firestoreMockModule());

import { getProject } from "./getProject";

describe("getProject", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetProjectsTestSupport();
    Object.assign(usersStore, {
      "admin-1": { role: "admin" },
      "volunteer-1": { role: "volunteer", active: true },
    });
    Object.assign(projectsStore, {
      "proj-1": {
        title: "Maker Faire",
        description: "desc",
        projectType: "evento",
        status: "active",
        checklists: [],
        createdBy: "admin-1",
      },
    });
    eventsStore["proj-1"] = {
      "ev-1": { fromStatus: "new", toStatus: "active", note: "ok", createdBy: "admin-1", timestamp: { seconds: 2 } },
    };
  });

  it("returns the normalized project and its events for an admin", async () => {
    const result = (await getProject.run(buildRequest({ projectId: "proj-1" }, "admin-1"))) as {
      project: { id: string; title: string };
      events: Array<{ id: string; note?: string }>;
    };

    expect(result.project).toEqual(
      expect.objectContaining({ id: "proj-1", title: "Maker Faire", projectType: "evento" })
    );
    expect(result.events).toEqual([expect.objectContaining({ id: "ev-1", note: "ok" })]);
  });

  it("allows a volunteer to read a project", async () => {
    const result = (await getProject.run(buildRequest({ projectId: "proj-1" }, "volunteer-1"))) as {
      project: { id: string };
    };
    expect(result.project.id).toBe("proj-1");
  });

  it("normalizes legacy name/createdByUid fields", async () => {
    projectsStore["proj-legacy"] = {
      name: "Idee bike",
      status: "draft",
      createdByUid: "admin-1",
    };

    const result = (await getProject.run(buildRequest({ projectId: "proj-legacy" }, "admin-1"))) as {
      project: { title: string; status: string; createdBy: string };
    };

    expect(result.project).toEqual(
      expect.objectContaining({ title: "Idee bike", status: "new", createdBy: "admin-1" })
    );
  });

  it("throws not-found for a missing project", async () => {
    await expect(getProject.run(buildRequest({ projectId: "missing" }, "admin-1"))).rejects.toMatchObject(
      new HttpsError("not-found", "Project not found")
    );
  });

  it("denies a non-staff caller", async () => {
    await expect(getProject.run(buildRequest({ projectId: "proj-1" }, "ghost"))).rejects.toMatchObject(
      new HttpsError("permission-denied", "Only admin or volunteers can access projects")
    );
  });
});
