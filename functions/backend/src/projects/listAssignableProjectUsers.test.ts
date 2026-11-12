import { HttpsError } from "firebase-functions/v2/https";
import { usersStore, firestoreMockModule, buildRequest, resetProjectsTestSupport } from "./testSupport";

jest.mock("firebase-admin/firestore", () => firestoreMockModule());

import { listAssignableProjectUsers } from "./listAssignableProjectUsers";

describe("listAssignableProjectUsers", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetProjectsTestSupport();
    Object.assign(usersStore, {
      "admin-1": { role: "admin" },
      "admin-2": { role: "admin" },
      "volunteer-active-1": { role: "volunteer", active: true },
      "volunteer-active-2": { role: "volunteer", active: true },
      "volunteer-inactive": { role: "volunteer", active: false },
    });
  });

  it("returns every admin plus every active volunteer, no per-project restriction", async () => {
    const result = (await listAssignableProjectUsers.run(buildRequest({}, "volunteer-active-1"))) as {
      uids: string[];
    };

    expect(result.uids.sort()).toEqual(
      ["admin-1", "admin-2", "volunteer-active-1", "volunteer-active-2"].sort()
    );
  });

  it("excludes inactive volunteers", async () => {
    const result = (await listAssignableProjectUsers.run(buildRequest({}, "admin-1"))) as { uids: string[] };

    expect(result.uids).not.toContain("volunteer-inactive");
  });

  it("denies a caller without a staff role", async () => {
    await expect(listAssignableProjectUsers.run(buildRequest({}, "ghost"))).rejects.toMatchObject(
      new HttpsError("permission-denied", "Only admin or volunteers can access projects")
    );
  });

  it("throws unauthenticated when there is no auth context", async () => {
    await expect(listAssignableProjectUsers.run(buildRequest({}, null))).rejects.toMatchObject(
      new HttpsError("unauthenticated", "User must be authenticated")
    );
  });
});
