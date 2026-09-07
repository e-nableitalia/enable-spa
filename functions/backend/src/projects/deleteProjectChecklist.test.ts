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

const deleteChecklistRunMock = jest.fn().mockResolvedValue({ success: true });
jest.mock("../organizer/deleteChecklist", () => ({
  deleteChecklist: { run: (...args: unknown[]) => deleteChecklistRunMock(...args) },
}));

import { deleteProjectChecklist } from "./deleteProjectChecklist";

describe("deleteProjectChecklist", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    deleteChecklistRunMock.mockResolvedValue({ success: true });
    resetProjectsTestSupport();
    seedDefaultUsersAndProjects();
  });

  it("deletes the checklist and unlinks it from the project (admin)", async () => {
    const result = await deleteProjectChecklist.run(
      buildRequest({ projectId: "proj-active", checklistId: "checklist-1" }, "admin-1")
    );

    expect(result).toEqual({ success: true });
    expect(deleteChecklistRunMock).toHaveBeenCalledWith(
      expect.objectContaining({ data: { checklistId: "checklist-1" } })
    );
    expect(projectsStore["proj-active"]?.checklists).toEqual([]);
  });

  it("denies deletion to a volunteer", async () => {
    await expect(
      deleteProjectChecklist.run(buildRequest({ projectId: "proj-active", checklistId: "checklist-1" }, "volunteer-1"))
    ).rejects.toMatchObject(new HttpsError("permission-denied", "Only admin can perform this action"));
    expect(deleteChecklistRunMock).not.toHaveBeenCalled();
  });

  it("blocks deletion on standby/archived/closed projects", async () => {
    await expect(
      deleteProjectChecklist.run(buildRequest({ projectId: "proj-standby", checklistId: "checklist-2" }, "admin-1"))
    ).rejects.toMatchObject(
      new HttpsError(
        "failed-precondition",
        "This project's status does not allow modifications (only 'new'/'active' projects can be edited)"
      )
    );
    expect(deleteChecklistRunMock).not.toHaveBeenCalled();
  });

  it("throws not-found when the checklist is not linked to the project", async () => {
    await expect(
      deleteProjectChecklist.run(buildRequest({ projectId: "proj-active", checklistId: "unknown" }, "admin-1"))
    ).rejects.toMatchObject(new HttpsError("not-found", "Checklist not linked to this project"));
    expect(deleteChecklistRunMock).not.toHaveBeenCalled();
  });

  it("throws not-found for a missing project", async () => {
    await expect(
      deleteProjectChecklist.run(buildRequest({ projectId: "missing", checklistId: "c-1" }, "admin-1"))
    ).rejects.toMatchObject(new HttpsError("not-found", "Project not found"));
  });

  it("throws invalid-argument when checklistId is missing", async () => {
    await expect(
      deleteProjectChecklist.run(buildRequest({ projectId: "proj-active" }, "admin-1"))
    ).rejects.toMatchObject(new HttpsError("invalid-argument", "Missing or invalid checklistId"));
  });
});
