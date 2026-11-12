import { HttpsError } from "firebase-functions/v2/https";
import {
  firestoreMockModule,
  buildRequest,
  resetProjectsTestSupport,
  seedDefaultUsersAndProjects,
} from "./testSupport";

jest.mock("firebase-admin/firestore", () => firestoreMockModule());
jest.mock("../security/securityLog", () => ({ logSecurityEvent: jest.fn().mockResolvedValue(undefined) }));

const removeChecklistItemRunMock = jest.fn().mockResolvedValue({ success: true });
jest.mock("../organizer/removeChecklistItem", () => ({
  removeChecklistItem: { run: (...args: unknown[]) => removeChecklistItemRunMock(...args) },
}));

import { removeProjectChecklistItem } from "./removeProjectChecklistItem";

describe("removeProjectChecklistItem", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    removeChecklistItemRunMock.mockResolvedValue({ success: true });
    resetProjectsTestSupport();
    seedDefaultUsersAndProjects();
  });

  it("removes an item (admin)", async () => {
    const result = await removeProjectChecklistItem.run(
      buildRequest({ projectId: "proj-active", checklistId: "checklist-1", itemId: "item-1" }, "admin-1")
    );

    expect(result).toEqual({ success: true });
    expect(removeChecklistItemRunMock).toHaveBeenCalledWith(
      expect.objectContaining({ data: { checklistId: "checklist-1", itemId: "item-1" } })
    );
  });

  it("allows an active volunteer", async () => {
    const result = await removeProjectChecklistItem.run(
      buildRequest({ projectId: "proj-active", checklistId: "checklist-1", itemId: "item-1" }, "volunteer-1")
    );

    expect(result).toEqual({ success: true });
  });

  it("blocks removal on standby/archived/closed projects", async () => {
    await expect(
      removeProjectChecklistItem.run(
        buildRequest({ projectId: "proj-standby", checklistId: "checklist-2", itemId: "item-1" }, "admin-1")
      )
    ).rejects.toMatchObject(
      new HttpsError(
        "failed-precondition",
        "This project's status does not allow modifications (only 'new'/'active' projects can be edited)"
      )
    );
    expect(removeChecklistItemRunMock).not.toHaveBeenCalled();
  });

  it("throws not-found when the checklist does not belong to the project", async () => {
    await expect(
      removeProjectChecklistItem.run(
        buildRequest({ projectId: "proj-active", checklistId: "unknown", itemId: "item-1" }, "admin-1")
      )
    ).rejects.toMatchObject(new HttpsError("not-found", "Checklist not linked to this project"));
  });

  it("denies a caller without a staff role", async () => {
    await expect(
      removeProjectChecklistItem.run(
        buildRequest({ projectId: "proj-active", checklistId: "checklist-1", itemId: "item-1" }, "ghost")
      )
    ).rejects.toMatchObject(new HttpsError("permission-denied", "Only admin or volunteers can access projects"));
  });
});
