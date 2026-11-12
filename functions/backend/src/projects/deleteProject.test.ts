import { HttpsError } from "firebase-functions/v2/https";
import {
  projectsStore,
  eventsStore,
  firestoreMockModule,
  buildRequest,
  resetProjectsTestSupport,
  seedDefaultUsersAndProjects,
} from "./testSupport";

jest.mock("firebase-admin/firestore", () => firestoreMockModule());

const deleteChecklistRun = jest.fn().mockResolvedValue({ success: true });
jest.mock("../organizer/deleteChecklist", () => ({
  deleteChecklist: { run: (...args: unknown[]) => deleteChecklistRun(...args) },
}));

jest.mock("../security/securityLog", () => ({
  logSecurityEvent: jest.fn().mockResolvedValue(undefined),
}));

import { deleteProject } from "./deleteProject";

describe("deleteProject", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetProjectsTestSupport();
    seedDefaultUsersAndProjects();
    eventsStore["proj-active"] = {
      "ev-1": { note: "n", createdBy: "admin-1" },
    };
  });

  it("deletes the project, its events and linked checklists for an admin", async () => {
    const result = await deleteProject.run(buildRequest({ projectId: "proj-active" }, "admin-1"));

    expect(result).toEqual({ success: true });
    expect(deleteChecklistRun).toHaveBeenCalledWith(
      expect.objectContaining({ data: { checklistId: "checklist-1" } })
    );
    expect(projectsStore["proj-active"]).toBeUndefined();
    expect(eventsStore["proj-active"]).toBeUndefined();
  });

  it("allows deleting a terminal (archived) project", async () => {
    const result = await deleteProject.run(buildRequest({ projectId: "proj-archived" }, "admin-1"));
    expect(result).toEqual({ success: true });
    expect(projectsStore["proj-archived"]).toBeUndefined();
  });

  it("denies a volunteer", async () => {
    await expect(
      deleteProject.run(buildRequest({ projectId: "proj-new" }, "volunteer-1"))
    ).rejects.toMatchObject(new HttpsError("permission-denied", "Only admin can perform this action"));
    expect(projectsStore["proj-new"]).toBeDefined();
  });

  it("throws not-found for a missing project", async () => {
    await expect(deleteProject.run(buildRequest({ projectId: "missing" }, "admin-1"))).rejects.toMatchObject(
      new HttpsError("not-found", "Project not found")
    );
  });
});
