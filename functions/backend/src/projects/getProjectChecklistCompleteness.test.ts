import { HttpsError } from "firebase-functions/v2/https";
import {
  firestoreMockModule,
  buildRequest,
  resetProjectsTestSupport,
  seedDefaultUsersAndProjects,
} from "./testSupport";

jest.mock("firebase-admin/firestore", () => firestoreMockModule());

const getChecklistCompletenessRunMock = jest.fn().mockResolvedValue({ complete: false });
jest.mock("../organizer/getChecklistCompleteness", () => ({
  getChecklistCompleteness: { run: (...args: unknown[]) => getChecklistCompletenessRunMock(...args) },
}));

import { getProjectChecklistCompleteness } from "./getProjectChecklistCompleteness";

describe("getProjectChecklistCompleteness", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getChecklistCompletenessRunMock.mockResolvedValue({ complete: false });
    resetProjectsTestSupport();
    seedDefaultUsersAndProjects();
  });

  it("returns the completeness flag (admin)", async () => {
    const result = await getProjectChecklistCompleteness.run(
      buildRequest({ projectId: "proj-active", checklistId: "checklist-1" }, "admin-1")
    );

    expect(result).toEqual({ checklistId: "checklist-1", complete: false });
  });

  it("allows a volunteer to read", async () => {
    getChecklistCompletenessRunMock.mockResolvedValue({ complete: true });
    const result = await getProjectChecklistCompleteness.run(
      buildRequest({ projectId: "proj-active", checklistId: "checklist-1" }, "volunteer-1")
    );

    expect(result).toEqual({ checklistId: "checklist-1", complete: true });
  });

  it("throws not-found when the checklist does not belong to the project", async () => {
    await expect(
      getProjectChecklistCompleteness.run(
        buildRequest({ projectId: "proj-active", checklistId: "unknown" }, "admin-1")
      )
    ).rejects.toMatchObject(new HttpsError("not-found", "Checklist not linked to this project"));
  });

  it("denies a caller without a staff role", async () => {
    await expect(
      getProjectChecklistCompleteness.run(
        buildRequest({ projectId: "proj-active", checklistId: "checklist-1" }, "ghost")
      )
    ).rejects.toMatchObject(new HttpsError("permission-denied", "Only admin or volunteers can access projects"));
  });
});
