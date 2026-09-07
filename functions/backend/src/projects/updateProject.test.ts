import { HttpsError } from "firebase-functions/v2/https";
import {
  projectsStore,
  firestoreMockModule,
  buildRequest,
  resetProjectsTestSupport,
  seedDefaultUsersAndProjects,
} from "./testSupport";

jest.mock("firebase-admin/firestore", () => firestoreMockModule());
jest.mock("../security/securityLog", () => ({ logSecurityEvent: jest.fn().mockResolvedValue(undefined) }));

import { updateProject } from "./updateProject";

describe("updateProject", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetProjectsTestSupport();
    seedDefaultUsersAndProjects();
  });

  it("updates title and description of a 'new' project (admin)", async () => {
    const result = await updateProject.run(
      buildRequest({ projectId: "proj-new", title: "Nuovo titolo", description: "Nuova descrizione" }, "admin-1")
    );

    expect(result).toEqual({ success: true });
    expect(projectsStore["proj-new"]).toEqual(
      expect.objectContaining({ title: "Nuovo titolo", description: "Nuova descrizione" })
    );
  });

  it("allows a partial update (title only)", async () => {
    await updateProject.run(buildRequest({ projectId: "proj-active", title: "Solo titolo" }, "admin-1"));

    expect(projectsStore["proj-active"]).toEqual(
      expect.objectContaining({ title: "Solo titolo", description: "desc" })
    );
  });

  it("denies update to a volunteer", async () => {
    await expect(
      updateProject.run(buildRequest({ projectId: "proj-new", title: "X" }, "volunteer-1"))
    ).rejects.toMatchObject(new HttpsError("permission-denied", "Only admin can perform this action"));
  });

  it("blocks updates on standby/archived/closed projects", async () => {
    for (const projectId of ["proj-standby", "proj-archived", "proj-closed"]) {
      await expect(
        updateProject.run(buildRequest({ projectId, title: "X" }, "admin-1"))
      ).rejects.toMatchObject(
        new HttpsError(
          "failed-precondition",
          "This project's status does not allow modifications (only 'new'/'active' projects can be edited)"
        )
      );
    }
  });

  it("throws not-found for a missing project", async () => {
    await expect(
      updateProject.run(buildRequest({ projectId: "missing", title: "X" }, "admin-1"))
    ).rejects.toMatchObject(new HttpsError("not-found", "Project not found"));
  });

  it("throws invalid-argument when neither title nor description is provided", async () => {
    await expect(updateProject.run(buildRequest({ projectId: "proj-new" }, "admin-1"))).rejects.toMatchObject(
      new HttpsError("invalid-argument", "Nothing to update")
    );
  });

  it("throws invalid-argument for a blank title", async () => {
    await expect(
      updateProject.run(buildRequest({ projectId: "proj-new", title: "   " }, "admin-1"))
    ).rejects.toMatchObject(new HttpsError("invalid-argument", "title must be a non-empty string"));
  });

  it("throws unauthenticated when there is no auth context", async () => {
    await expect(
      updateProject.run(buildRequest({ projectId: "proj-new", title: "X" }, null))
    ).rejects.toMatchObject(new HttpsError("unauthenticated", "Authentication required"));
  });
});
