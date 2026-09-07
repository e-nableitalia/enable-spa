import { HttpsError } from "firebase-functions/v2/https";
import {
  firestoreMockModule,
  buildRequest,
  resetProjectsTestSupport,
  seedDefaultUsersAndProjects,
} from "./testSupport";

jest.mock("firebase-admin/firestore", () => firestoreMockModule());
jest.mock("../security/securityLog", () => ({ logSecurityEvent: jest.fn().mockResolvedValue(undefined) }));

const addChecklistItemRunMock = jest.fn().mockResolvedValue({ itemId: "item-1" });
jest.mock("../organizer/addChecklistItem", () => ({
  addChecklistItem: { run: (...args: unknown[]) => addChecklistItemRunMock(...args) },
}));

import { addProjectChecklistItem } from "./addProjectChecklistItem";

describe("addProjectChecklistItem", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    addChecklistItemRunMock.mockResolvedValue({ itemId: "item-1" });
    resetProjectsTestSupport();
    seedDefaultUsersAndProjects();
  });

  it("adds an item (admin)", async () => {
    const result = await addProjectChecklistItem.run(
      buildRequest({ projectId: "proj-active", checklistId: "checklist-1", title: "Fai X", type: "generic" }, "admin-1")
    );

    expect(result).toEqual({ itemId: "item-1" });
    expect(addChecklistItemRunMock).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ checklistId: "checklist-1", title: "Fai X" }) })
    );
  });

  it("allows an active volunteer, unlike device-requests there is no per-project assignment restriction", async () => {
    const result = await addProjectChecklistItem.run(
      buildRequest({ projectId: "proj-active", checklistId: "checklist-1", title: "Fai X", type: "generic" }, "volunteer-1")
    );

    expect(result).toEqual({ itemId: "item-1" });
  });

  it("resolves an admin or active volunteer as assignee", async () => {
    await addProjectChecklistItem.run(
      buildRequest(
        { projectId: "proj-active", checklistId: "checklist-1", title: "Fai X", type: "generic", assignee: "volunteer-1" },
        "admin-1"
      )
    );

    expect(addChecklistItemRunMock).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ assignee: "volunteer-1" }) })
    );
  });

  it("rejects an inactive volunteer as assignee", async () => {
    await expect(
      addProjectChecklistItem.run(
        buildRequest(
          {
            projectId: "proj-active",
            checklistId: "checklist-1",
            title: "Fai X",
            type: "generic",
            assignee: "volunteer-inactive",
          },
          "admin-1"
        )
      )
    ).rejects.toMatchObject(
      new HttpsError("invalid-argument", "Assignee must be the Firebase uid of an admin or an active volunteer")
    );
    expect(addChecklistItemRunMock).not.toHaveBeenCalled();
  });

  it("blocks addition on standby/archived/closed projects", async () => {
    await expect(
      addProjectChecklistItem.run(
        buildRequest({ projectId: "proj-standby", checklistId: "checklist-2", title: "T", type: "generic" }, "admin-1")
      )
    ).rejects.toMatchObject(
      new HttpsError(
        "failed-precondition",
        "This project's status does not allow modifications (only 'new'/'active' projects can be edited)"
      )
    );
  });

  it("throws not-found when the checklist does not belong to the project", async () => {
    await expect(
      addProjectChecklistItem.run(
        buildRequest({ projectId: "proj-active", checklistId: "unknown", title: "T", type: "generic" }, "admin-1")
      )
    ).rejects.toMatchObject(new HttpsError("not-found", "Checklist not linked to this project"));
  });

  it("denies a caller without a staff role", async () => {
    await expect(
      addProjectChecklistItem.run(
        buildRequest({ projectId: "proj-active", checklistId: "checklist-1", title: "T", type: "generic" }, "ghost")
      )
    ).rejects.toMatchObject(new HttpsError("permission-denied", "Only admin or volunteers can access projects"));
  });
});
