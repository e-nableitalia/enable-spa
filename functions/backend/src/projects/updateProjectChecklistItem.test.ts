import { HttpsError } from "firebase-functions/v2/https";
import {
  firestoreMockModule,
  buildRequest,
  resetProjectsTestSupport,
  seedDefaultUsersAndProjects,
} from "./testSupport";

jest.mock("firebase-admin/firestore", () => firestoreMockModule());
jest.mock("../security/securityLog", () => ({ logSecurityEvent: jest.fn().mockResolvedValue(undefined) }));

const updateChecklistItemRunMock = jest.fn().mockResolvedValue({ success: true });
jest.mock("../organizer/updateChecklistItem", () => ({
  updateChecklistItem: { run: (...args: unknown[]) => updateChecklistItemRunMock(...args) },
}));

import { updateProjectChecklistItem } from "./updateProjectChecklistItem";

describe("updateProjectChecklistItem", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    updateChecklistItemRunMock.mockResolvedValue({ success: true });
    resetProjectsTestSupport();
    seedDefaultUsersAndProjects();
  });

  it("updates an item (admin)", async () => {
    const result = await updateProjectChecklistItem.run(
      buildRequest(
        { projectId: "proj-active", checklistId: "checklist-1", itemId: "item-1", completed: true },
        "admin-1"
      )
    );

    expect(result).toEqual({ success: true });
    expect(updateChecklistItemRunMock).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ itemId: "item-1", completed: true }) })
    );
  });

  it("allows an active volunteer", async () => {
    const result = await updateProjectChecklistItem.run(
      buildRequest({ projectId: "proj-active", checklistId: "checklist-1", itemId: "item-1" }, "volunteer-1")
    );

    expect(result).toEqual({ success: true });
  });

  it("accepts free-text assignee values", async () => {
    const result = await updateProjectChecklistItem.run(
      buildRequest(
        { projectId: "proj-active", checklistId: "checklist-1", itemId: "item-1", assignee: "volunteer-inactive" },
        "admin-1"
      )
    );
    expect(result).toEqual({ success: true });
    expect(updateChecklistItemRunMock).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ assignee: "volunteer-inactive" }) })
    );
  });

  it("blocks update on standby/archived/closed projects", async () => {
    await expect(
      updateProjectChecklistItem.run(
        buildRequest({ projectId: "proj-closed", checklistId: "checklist-1", itemId: "item-1" }, "admin-1")
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
      updateProjectChecklistItem.run(
        buildRequest({ projectId: "proj-active", checklistId: "unknown", itemId: "item-1" }, "admin-1")
      )
    ).rejects.toMatchObject(new HttpsError("not-found", "Checklist not linked to this project"));
  });
});
