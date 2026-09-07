import { HttpsError } from "firebase-functions/v2/https";
import { usersStore, projectsStore, firestoreMockModule, buildRequest, resetProjectsTestSupport } from "./testSupport";

jest.mock("firebase-admin/firestore", () => firestoreMockModule());

import { listProjects } from "./listProjects";

describe("listProjects", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetProjectsTestSupport();
    Object.assign(usersStore, {
      "admin-1": { role: "admin" },
      "volunteer-1": { role: "volunteer", active: true },
    });
    Object.assign(projectsStore, {
      "proj-1": { title: "A", projectType: "progetto", status: "new", checklists: [], createdBy: "admin-1" },
      "proj-2": { title: "B", projectType: "evento", status: "active", checklists: [], createdBy: "admin-1" },
    });
  });

  it("returns every project for an admin", async () => {
    const result = (await listProjects.run(buildRequest({}, "admin-1"))) as {
      projects: Array<{ id: string }>;
    };
    expect(result.projects.map((p) => p.id).sort()).toEqual(["proj-1", "proj-2"]);
  });

  it("returns every project for a volunteer too (staff-only, not admin-only)", async () => {
    const result = (await listProjects.run(buildRequest({}, "volunteer-1"))) as {
      projects: Array<{ id: string }>;
    };
    expect(result.projects.map((p) => p.id).sort()).toEqual(["proj-1", "proj-2"]);
  });

  it("denies a caller without a staff role", async () => {
    await expect(listProjects.run(buildRequest({}, "ghost"))).rejects.toMatchObject(
      new HttpsError("permission-denied", "Only admin or volunteers can access projects")
    );
  });

  it("throws unauthenticated when there is no auth context", async () => {
    await expect(listProjects.run(buildRequest({}, null))).rejects.toMatchObject(
      new HttpsError("unauthenticated", "User must be authenticated")
    );
  });
});
