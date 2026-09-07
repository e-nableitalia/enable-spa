import { HttpsError } from "firebase-functions/v2/https";
import type { CallableRequest } from "firebase-functions/v2/https";

const usersStore: Record<string, Record<string, unknown> | undefined> = {};

jest.mock("firebase-admin/firestore", () => ({
  getFirestore: jest.fn(() => ({
    collection: (name: string) => {
      if (name !== "users") throw new Error(`Unexpected collection ${name}`);
      return {
        doc: (uid: string) => ({
          get: () =>
            Promise.resolve({ exists: usersStore[uid] !== undefined, data: () => usersStore[uid] }),
        }),
      };
    },
  })),
}));

jest.mock("../security/securityLog", () => ({ logSecurityEvent: jest.fn().mockResolvedValue(undefined) }));

const exportDocumentsMock = jest.fn();
const databasePathMock = jest.fn((projectId: string, dbId: string) => `projects/${projectId}/databases/${dbId}`);
jest.mock("@google-cloud/firestore", () => ({
  v1: {
    FirestoreAdminClient: jest.fn().mockImplementation(() => ({
      exportDocuments: exportDocumentsMock,
      databasePath: databasePathMock,
    })),
  },
}));

import { triggerFirestoreBackup } from "./triggerFirestoreBackup";

function buildRequest(uid: string | null): CallableRequest {
  return {
    auth: uid ? ({ uid } as CallableRequest["auth"]) : undefined,
    data: {},
    rawRequest: { headers: {} } as CallableRequest["rawRequest"],
  } as CallableRequest;
}

describe("triggerFirestoreBackup", () => {
  const originalProjectId = process.env.GCLOUD_PROJECT;

  beforeEach(() => {
    jest.clearAllMocks();
    for (const k of Object.keys(usersStore)) delete usersStore[k];
    usersStore["superadmin-1"] = { role: "admin", superAdmin: true };
    usersStore["admin-1"] = { role: "admin" };
    process.env.GCLOUD_PROJECT = "enableitalia-staging";
    exportDocumentsMock.mockResolvedValue([{ name: "operations/abc123" }]);
  });

  afterAll(() => {
    process.env.GCLOUD_PROJECT = originalProjectId;
  });

  it("starts the export to the project's dedicated backup bucket for a super admin", async () => {
    const result = (await triggerFirestoreBackup.run(buildRequest("superadmin-1"))) as {
      outputUriPrefix: string;
      operationName: string;
    };

    expect(exportDocumentsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "projects/enableitalia-staging/databases/(default)",
        outputUriPrefix: expect.stringMatching(/^gs:\/\/enableitalia-staging-firestore-backups\//),
      })
    );
    expect(result.outputUriPrefix).toMatch(/^gs:\/\/enableitalia-staging-firestore-backups\//);
    expect(result.operationName).toBe("operations/abc123");
  });

  it("denies an admin without the superAdmin flag, starts no export", async () => {
    await expect(triggerFirestoreBackup.run(buildRequest("admin-1"))).rejects.toMatchObject(
      new HttpsError("permission-denied", "Only a super admin can perform this action")
    );
    expect(exportDocumentsMock).not.toHaveBeenCalled();
  });

  it("throws unauthenticated when there is no auth context", async () => {
    await expect(triggerFirestoreBackup.run(buildRequest(null))).rejects.toMatchObject(
      new HttpsError("unauthenticated", "Authentication required")
    );
    expect(exportDocumentsMock).not.toHaveBeenCalled();
  });

  it("surfaces an internal error if the export call fails", async () => {
    exportDocumentsMock.mockRejectedValue(new Error("boom"));

    await expect(triggerFirestoreBackup.run(buildRequest("superadmin-1"))).rejects.toMatchObject(
      new HttpsError("internal", "Internal Server Error")
    );
  });
});
