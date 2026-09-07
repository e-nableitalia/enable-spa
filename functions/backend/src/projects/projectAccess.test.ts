import { HttpsError } from "firebase-functions/v2/https";
import { usersStore, projectsStore, collectionMock, firestoreMockModule, resetProjectsTestSupport } from "./testSupport";

jest.mock("firebase-admin/firestore", () => firestoreMockModule());

import {
  isValidProjectStatus,
  requireStaffRole,
  requireAdmin,
  getProjectOrThrow,
  assertProjectContentWritable,
  assertProjectNotTerminal,
  assertChecklistBelongsToProject,
  isResolvableProjectAssignee,
} from "./projectAccess";
import { getFirestore } from "firebase-admin/firestore";

describe("projectAccess", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetProjectsTestSupport();
    Object.assign(usersStore, {
      "admin-1": { role: "admin" },
      "volunteer-active": { role: "volunteer", active: true },
      "volunteer-inactive": { role: "volunteer", active: false },
    });
    Object.assign(projectsStore, {
      "proj-1": {
        title: "T",
        description: "D",
        projectType: "progetto",
        status: "active",
        checklists: [{ checklistId: "cl-1", label: "Fase 1" }],
        createdBy: "admin-1",
      },
    });
  });

  const db = () => getFirestore();

  describe("isValidProjectStatus", () => {
    it("accepts the five known statuses", () => {
      for (const s of ["new", "active", "standby", "archived", "closed"]) {
        expect(isValidProjectStatus(s)).toBe(true);
      }
    });

    it("rejects unknown strings and non-strings", () => {
      expect(isValidProjectStatus("done")).toBe(false);
      expect(isValidProjectStatus(undefined)).toBe(false);
      expect(isValidProjectStatus(42)).toBe(false);
    });
  });

  describe("requireStaffRole", () => {
    it("resolves for admin and volunteer", async () => {
      await expect(requireStaffRole(db(), "admin-1")).resolves.toBe("admin");
      await expect(requireStaffRole(db(), "volunteer-active")).resolves.toBe("volunteer");
    });

    it("throws permission-denied for an unknown user", async () => {
      await expect(requireStaffRole(db(), "ghost")).rejects.toMatchObject(
        new HttpsError("permission-denied", "Only admin or volunteers can access projects")
      );
    });
  });

  describe("requireAdmin", () => {
    it("resolves for admin", async () => {
      await expect(requireAdmin(db(), "admin-1")).resolves.toBeUndefined();
    });

    it("throws permission-denied for a volunteer", async () => {
      await expect(requireAdmin(db(), "volunteer-active")).rejects.toMatchObject(
        new HttpsError("permission-denied", "Only admin can perform this action")
      );
    });
  });

  describe("getProjectOrThrow", () => {
    it("returns the project doc with its id", async () => {
      const project = await getProjectOrThrow(db(), "proj-1");
      expect(project).toEqual(expect.objectContaining({ id: "proj-1", title: "T", status: "active" }));
    });

    it("throws not-found for a missing project", async () => {
      await expect(getProjectOrThrow(db(), "missing")).rejects.toMatchObject(
        new HttpsError("not-found", "Project not found")
      );
    });
  });

  describe("assertProjectContentWritable", () => {
    it("allows new/active", () => {
      expect(() => assertProjectContentWritable("new")).not.toThrow();
      expect(() => assertProjectContentWritable("active")).not.toThrow();
    });

    it("blocks standby/archived/closed", () => {
      for (const s of ["standby", "archived", "closed"]) {
        expect(() => assertProjectContentWritable(s)).toThrow(HttpsError);
      }
    });
  });

  describe("assertProjectNotTerminal", () => {
    it("allows new/active/standby", () => {
      for (const s of ["new", "active", "standby"]) {
        expect(() => assertProjectNotTerminal(s)).not.toThrow();
      }
    });

    it("blocks archived/closed", () => {
      for (const s of ["archived", "closed"]) {
        expect(() => assertProjectNotTerminal(s)).toThrow(HttpsError);
      }
    });
  });

  describe("assertChecklistBelongsToProject", () => {
    it("passes when the checklist is linked", async () => {
      const project = await getProjectOrThrow(db(), "proj-1");
      expect(() => assertChecklistBelongsToProject(project, "cl-1")).not.toThrow();
    });

    it("throws not-found when the checklist is not linked", async () => {
      const project = await getProjectOrThrow(db(), "proj-1");
      expect(() => assertChecklistBelongsToProject(project, "cl-unknown")).toThrow(
        new HttpsError("not-found", "Checklist not linked to this project")
      );
    });
  });

  describe("isResolvableProjectAssignee", () => {
    it("resolves true for admin and active volunteer", async () => {
      await expect(isResolvableProjectAssignee(db(), "admin-1")).resolves.toBe(true);
      await expect(isResolvableProjectAssignee(db(), "volunteer-active")).resolves.toBe(true);
    });

    it("resolves false for inactive volunteer or unknown user", async () => {
      await expect(isResolvableProjectAssignee(db(), "volunteer-inactive")).resolves.toBe(false);
      await expect(isResolvableProjectAssignee(db(), "ghost")).resolves.toBe(false);
    });
  });

  it("uses the shared collectionMock (sanity check on the test double wiring)", async () => {
    await getProjectOrThrow(db(), "proj-1");
    expect(collectionMock).toHaveBeenCalledWith("projects");
  });
});
