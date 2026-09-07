import { HttpsError } from "firebase-functions/v2/https";
import { usersStore, projectsStore, firestoreMockModule, buildRequest, resetProjectsTestSupport } from "./testSupport";

jest.mock("firebase-admin/firestore", () => firestoreMockModule());
jest.mock("../security/securityLog", () => ({ logSecurityEvent: jest.fn().mockResolvedValue(undefined) }));

import { createProject } from "./createProject";

describe("createProject", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetProjectsTestSupport();
    Object.assign(usersStore, {
      "admin-1": { role: "admin" },
      "volunteer-1": { role: "volunteer", active: true },
    });
  });

  it("creates a project with status 'new' and empty checklists (admin)", async () => {
    const result = (await createProject.run(
      buildRequest({ title: "Device multifunzione", projectType: "progetto", description: "desc" }, "admin-1")
    )) as { projectId: string };

    expect(result.projectId).toBeTruthy();
    expect(projectsStore[result.projectId]).toEqual(
      expect.objectContaining({
        title: "Device multifunzione",
        projectType: "progetto",
        description: "desc",
        status: "new",
        checklists: [],
        createdBy: "admin-1",
      })
    );
  });

  it("defaults description to an empty string when omitted", async () => {
    const result = (await createProject.run(
      buildRequest({ title: "Maker Faire", projectType: "evento" }, "admin-1")
    )) as { projectId: string };

    expect(projectsStore[result.projectId]).toEqual(expect.objectContaining({ description: "" }));
  });

  it("trims the title", async () => {
    const result = (await createProject.run(
      buildRequest({ title: "  Titolo  ", projectType: "progetto" }, "admin-1")
    )) as { projectId: string };

    expect(projectsStore[result.projectId]?.title).toBe("Titolo");
  });

  it("denies creation to a volunteer", async () => {
    await expect(
      createProject.run(buildRequest({ title: "T", projectType: "progetto" }, "volunteer-1"))
    ).rejects.toMatchObject(new HttpsError("permission-denied", "Only admin can perform this action"));
  });

  it("throws unauthenticated when there is no auth context", async () => {
    await expect(
      createProject.run(buildRequest({ title: "T", projectType: "progetto" }, null))
    ).rejects.toMatchObject(new HttpsError("unauthenticated", "Authentication required"));
  });

  it("throws invalid-argument when title is missing or blank", async () => {
    await expect(createProject.run(buildRequest({ projectType: "progetto" }, "admin-1"))).rejects.toMatchObject(
      new HttpsError("invalid-argument", "Missing or invalid title")
    );
    await expect(
      createProject.run(buildRequest({ title: "   ", projectType: "progetto" }, "admin-1"))
    ).rejects.toMatchObject(new HttpsError("invalid-argument", "Missing or invalid title"));
  });

  it("throws invalid-argument when projectType is missing or blank", async () => {
    await expect(createProject.run(buildRequest({ title: "T" }, "admin-1"))).rejects.toMatchObject(
      new HttpsError("invalid-argument", "Missing or invalid projectType")
    );
  });

  it("throws invalid-argument when description is not a string", async () => {
    await expect(
      createProject.run(buildRequest({ title: "T", projectType: "progetto", description: 42 }, "admin-1"))
    ).rejects.toMatchObject(new HttpsError("invalid-argument", "description must be a string"));
  });
});
