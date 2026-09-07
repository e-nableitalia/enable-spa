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
jest.mock("../security/securityLog", () => ({ logSecurityEvent: jest.fn().mockResolvedValue(undefined) }));

import { changeProjectStatus } from "./changeProjectStatus";

describe("changeProjectStatus", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetProjectsTestSupport();
    seedDefaultUsersAndProjects();
  });

  it("transitions status and records an event (admin)", async () => {
    const result = (await changeProjectStatus.run(
      buildRequest({ projectId: "proj-new", newStatus: "active", note: "Si parte" }, "admin-1")
    )) as { success: boolean; eventId: string };

    expect(result.success).toBe(true);
    expect(projectsStore["proj-new"]?.status).toBe("active");
    expect(eventsStore["proj-new"]?.[result.eventId]).toEqual(
      expect.objectContaining({ fromStatus: "new", toStatus: "active", note: "Si parte", createdBy: "admin-1" })
    );
  });

  it("allows adding a note without changing status (newStatus === current status)", async () => {
    const result = (await changeProjectStatus.run(
      buildRequest({ projectId: "proj-active", newStatus: "active", note: "Solo una nota" }, "admin-1")
    )) as { eventId: string };

    expect(projectsStore["proj-active"]?.status).toBe("active");
    expect(eventsStore["proj-active"]?.[result.eventId]).toEqual(
      expect.objectContaining({ fromStatus: "active", toStatus: "active", note: "Solo una nota" })
    );
  });

  it("allows a note in standby (the one modification standby permits)", async () => {
    await changeProjectStatus.run(
      buildRequest({ projectId: "proj-standby", newStatus: "standby", note: "Nota in standby" }, "admin-1")
    );

    expect(projectsStore["proj-standby"]?.status).toBe("standby");
  });

  it("allows a real transition out of standby (standby would otherwise be a dead end)", async () => {
    await changeProjectStatus.run(buildRequest({ projectId: "proj-standby", newStatus: "active" }, "admin-1"));

    expect(projectsStore["proj-standby"]?.status).toBe("active");
  });

  it("blocks any change on archived/closed projects, including a note-only update", async () => {
    for (const projectId of ["proj-archived", "proj-closed"]) {
      const status = projectsStore[projectId]?.status as string;
      await expect(
        changeProjectStatus.run(buildRequest({ projectId, newStatus: status, note: "x" }, "admin-1"))
      ).rejects.toMatchObject(
        new HttpsError("failed-precondition", "This project is archived/closed: no further changes are allowed")
      );
    }
  });

  it("denies the transition to a volunteer", async () => {
    await expect(
      changeProjectStatus.run(buildRequest({ projectId: "proj-new", newStatus: "active" }, "volunteer-1"))
    ).rejects.toMatchObject(new HttpsError("permission-denied", "Only admin can perform this action"));
  });

  it("throws invalid-argument for an unknown newStatus", async () => {
    await expect(
      changeProjectStatus.run(buildRequest({ projectId: "proj-new", newStatus: "done" }, "admin-1"))
    ).rejects.toMatchObject(new HttpsError("invalid-argument", "Missing or invalid newStatus"));
  });

  it("throws not-found for a missing project", async () => {
    await expect(
      changeProjectStatus.run(buildRequest({ projectId: "missing", newStatus: "active" }, "admin-1"))
    ).rejects.toMatchObject(new HttpsError("not-found", "Project not found"));
  });

  it("throws unauthenticated when there is no auth context", async () => {
    await expect(
      changeProjectStatus.run(buildRequest({ projectId: "proj-new", newStatus: "active" }, null))
    ).rejects.toMatchObject(new HttpsError("unauthenticated", "Authentication required"));
  });
});
