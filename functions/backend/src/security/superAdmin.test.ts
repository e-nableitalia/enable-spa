import { HttpsError } from "firebase-functions/v2/https";
import { requireSuperAdmin } from "./superAdmin";

function buildDb(usersStore: Record<string, Record<string, unknown> | undefined>) {
  return {
    collection: (name: string) => {
      if (name !== "users") throw new Error(`Unexpected collection ${name}`);
      return {
        doc: (uid: string) => ({
          get: () =>
            Promise.resolve({
              exists: usersStore[uid] !== undefined,
              data: () => usersStore[uid],
            }),
        }),
      };
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

describe("requireSuperAdmin", () => {
  it("resolves without error for a real super admin", async () => {
    const db = buildDb({ "user-1": { role: "admin", superAdmin: true } });

    await expect(requireSuperAdmin(db, "user-1")).resolves.toBeUndefined();
  });

  it("denies an admin without the superAdmin flag", async () => {
    const db = buildDb({ "user-1": { role: "admin" } });

    await expect(requireSuperAdmin(db, "user-1")).rejects.toMatchObject(
      new HttpsError("permission-denied", "Only a super admin can perform this action")
    );
  });

  it("denies an admin with superAdmin explicitly false", async () => {
    const db = buildDb({ "user-1": { role: "admin", superAdmin: false } });

    await expect(requireSuperAdmin(db, "user-1")).rejects.toMatchObject(
      new HttpsError("permission-denied", "Only a super admin can perform this action")
    );
  });

  it("denies a non-existent user", async () => {
    const db = buildDb({});

    await expect(requireSuperAdmin(db, "ghost")).rejects.toMatchObject(
      new HttpsError("permission-denied", "Only a super admin can perform this action")
    );
  });
});
