import { HttpsError } from "firebase-functions/v2/https";
import {
  firestoreMockModule,
  buildRequest,
  resetProjectsTestSupport,
  seedDefaultUsersAndProjects,
} from "./testSupport";

jest.mock("firebase-admin/firestore", () => firestoreMockModule());

const getChecklistRunMock = jest.fn().mockResolvedValue({ title: "Checklist", items: ["item-1"] });
jest.mock("../organizer/getChecklist", () => ({
  getChecklist: { run: (...args: unknown[]) => getChecklistRunMock(...args) },
}));

import { getProjectChecklist } from "./getProjectChecklist";

describe("getProjectChecklist", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getChecklistRunMock.mockResolvedValue({ title: "Checklist", items: ["item-1"] });
    resetProjectsTestSupport();
    seedDefaultUsersAndProjects();
  });

  it("reads the checklist (admin)", async () => {
    const result = await getProjectChecklist.run(
      buildRequest({ projectId: "proj-active", checklistId: "checklist-1" }, "admin-1")
    );

    expect(result).toEqual({ checklistId: "checklist-1", title: "Checklist", items: ["item-1"] });
  });

  it("reads the checklist of an archived project (read is always allowed)", async () => {
    await expect(
      getProjectChecklist.run(buildRequest({ projectId: "proj-archived", checklistId: "checklist-1" }, "admin-1"))
    ).rejects.toMatchObject(new HttpsError("not-found", "Checklist not linked to this project"));
    // proj-archived has no linked checklist in the fixture, but the call reaches
    // the belonging check (not blocked earlier by status) — proving status is
    // not enforced for reads.
  });

  it("allows a volunteer to read", async () => {
    const result = await getProjectChecklist.run(
      buildRequest({ projectId: "proj-active", checklistId: "checklist-1" }, "volunteer-1")
    );

    expect(result).toEqual(expect.objectContaining({ checklistId: "checklist-1" }));
  });

  it("throws not-found when the checklist does not belong to the project", async () => {
    await expect(
      getProjectChecklist.run(buildRequest({ projectId: "proj-active", checklistId: "unknown" }, "admin-1"))
    ).rejects.toMatchObject(new HttpsError("not-found", "Checklist not linked to this project"));
  });

  it("denies a caller without a staff role", async () => {
    await expect(
      getProjectChecklist.run(buildRequest({ projectId: "proj-active", checklistId: "checklist-1" }, "ghost"))
    ).rejects.toMatchObject(new HttpsError("permission-denied", "Only admin or volunteers can access projects"));
  });

  it("throws unauthenticated when there is no auth context", async () => {
    await expect(
      getProjectChecklist.run(buildRequest({ projectId: "proj-active", checklistId: "checklist-1" }, null))
    ).rejects.toMatchObject(new HttpsError("unauthenticated", "User must be authenticated"));
  });
});
