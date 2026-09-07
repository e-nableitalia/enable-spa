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

const createChecklistRunMock = jest.fn().mockResolvedValue({ checklistId: "new-checklist-id" });
const createChecklistFromTemplateRunMock = jest.fn().mockResolvedValue({ checklistId: "from-template-id" });

// Il core Organizer è già coperto dai propri test: qui interessa solo il
// comportamento del wrapper (RBAC, guardie di stato, bookkeeping su
// `checklists`), quindi le funzioni core sono mockate invece di
// re-implementare le collection `checklists`/`checklistItems`.
jest.mock("../organizer/createChecklist", () => ({ createChecklist: { run: (...args: unknown[]) => createChecklistRunMock(...args) } }));
jest.mock("../organizer/createChecklistFromTemplate", () => ({
  createChecklistFromTemplate: { run: (...args: unknown[]) => createChecklistFromTemplateRunMock(...args) },
}));

import { createProjectChecklist } from "./createProjectChecklist";

describe("createProjectChecklist", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    createChecklistRunMock.mockResolvedValue({ checklistId: "new-checklist-id" });
    createChecklistFromTemplateRunMock.mockResolvedValue({ checklistId: "from-template-id" });
    resetProjectsTestSupport();
    seedDefaultUsersAndProjects();
  });

  it("creates a blank checklist and links it to the project (admin, no templateId)", async () => {
    const result = (await createProjectChecklist.run(
      buildRequest({ projectId: "proj-new", label: "Fase 1", title: "Checklist fase 1" }, "admin-1")
    )) as { checklistId: string };

    expect(result.checklistId).toBe("new-checklist-id");
    expect(createChecklistRunMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          category: "progetto",
          title: "Checklist fase 1",
          items: [],
          origin: { type: "project", id: "proj-new" },
        }),
      })
    );
    expect(projectsStore["proj-new"]?.checklists).toEqual([{ checklistId: "new-checklist-id", label: "Fase 1" }]);
  });

  it("instantiates from an explicit templateId", async () => {
    const result = (await createProjectChecklist.run(
      buildRequest(
        { projectId: "proj-new", label: "Fase 1", title: "Checklist fase 1", templateId: "tmpl-1" },
        "admin-1"
      )
    )) as { checklistId: string };

    expect(result.checklistId).toBe("from-template-id");
    expect(createChecklistFromTemplateRunMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ templateId: "tmpl-1", category: "progetto" }),
      })
    );
    expect(createChecklistRunMock).not.toHaveBeenCalled();
  });

  it("appends to existing checklists without dropping them", async () => {
    await createProjectChecklist.run(
      buildRequest({ projectId: "proj-active", label: "Fase 2", title: "T" }, "admin-1")
    );

    expect(projectsStore["proj-active"]?.checklists).toEqual([
      { checklistId: "checklist-1", label: "Fase 1" },
      { checklistId: "new-checklist-id", label: "Fase 2" },
    ]);
  });

  it("denies creation to a volunteer", async () => {
    await expect(
      createProjectChecklist.run(buildRequest({ projectId: "proj-new", label: "L", title: "T" }, "volunteer-1"))
    ).rejects.toMatchObject(new HttpsError("permission-denied", "Only admin can perform this action"));
    expect(createChecklistRunMock).not.toHaveBeenCalled();
  });

  it("blocks creation on standby/archived/closed projects", async () => {
    for (const projectId of ["proj-standby", "proj-archived", "proj-closed"]) {
      await expect(
        createProjectChecklist.run(buildRequest({ projectId, label: "L", title: "T" }, "admin-1"))
      ).rejects.toMatchObject(
        new HttpsError(
          "failed-precondition",
          "This project's status does not allow modifications (only 'new'/'active' projects can be edited)"
        )
      );
    }
    expect(createChecklistRunMock).not.toHaveBeenCalled();
  });

  it("throws invalid-argument when label or title is missing", async () => {
    await expect(
      createProjectChecklist.run(buildRequest({ projectId: "proj-new", title: "T" }, "admin-1"))
    ).rejects.toMatchObject(new HttpsError("invalid-argument", "Missing or invalid label"));
    await expect(
      createProjectChecklist.run(buildRequest({ projectId: "proj-new", label: "L" }, "admin-1"))
    ).rejects.toMatchObject(new HttpsError("invalid-argument", "Missing or invalid title"));
  });

  it("throws not-found for a missing project", async () => {
    await expect(
      createProjectChecklist.run(buildRequest({ projectId: "missing", label: "L", title: "T" }, "admin-1"))
    ).rejects.toMatchObject(new HttpsError("not-found", "Project not found"));
  });
});
