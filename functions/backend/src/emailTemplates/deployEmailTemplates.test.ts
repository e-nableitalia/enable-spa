import { HttpsError } from "firebase-functions/v2/https";
import type { CallableRequest } from "firebase-functions/v2/https";

const usersStore: Record<string, Record<string, unknown> | undefined> = {};
const templatesStore: Record<string, Record<string, unknown> | undefined> = {};

const batchSetMock = jest.fn((ref: { id: string }, data: Record<string, unknown>) => {
  templatesStore[ref.id] = data;
});
const batchCommitMock = jest.fn().mockResolvedValue(undefined);

jest.mock("firebase-admin/firestore", () => ({
  getFirestore: jest.fn(() => ({
    collection: (name: string) => {
      if (name === "users") {
        return {
          doc: (uid: string) => ({
            get: () =>
              Promise.resolve({ exists: usersStore[uid] !== undefined, data: () => usersStore[uid] }),
          }),
        };
      }
      if (name === "emailTemplates") {
        return { doc: (id: string) => ({ id }) };
      }
      throw new Error(`Unexpected collection ${name}`);
    },
    batch: () => ({ set: batchSetMock, commit: batchCommitMock }),
  })),
}));

jest.mock("../security/securityLog", () => ({ logSecurityEvent: jest.fn().mockResolvedValue(undefined) }));

import { deployEmailTemplates } from "./deployEmailTemplates";
import { EMAIL_TEMPLATE_IDS, EMAIL_TEMPLATES } from "./registry";

function buildRequest(uid: string | null): CallableRequest {
  return {
    auth: uid ? ({ uid } as CallableRequest["auth"]) : undefined,
    data: {},
    rawRequest: { headers: {} } as CallableRequest["rawRequest"],
  } as CallableRequest;
}

describe("deployEmailTemplates", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    for (const k of Object.keys(usersStore)) delete usersStore[k];
    for (const k of Object.keys(templatesStore)) delete templatesStore[k];
    usersStore["superadmin-1"] = { role: "admin", superAdmin: true };
    usersStore["admin-1"] = { role: "admin" };
  });

  it("writes all 5 registry entries to emailTemplates for a super admin", async () => {
    const result = (await deployEmailTemplates.run(buildRequest("superadmin-1"))) as { templateIds: string[] };

    expect(result.templateIds.sort()).toEqual(Object.keys(EMAIL_TEMPLATES).sort());
    expect(templatesStore[EMAIL_TEMPLATE_IDS.deviceRequestDocumentsTransmission]).toEqual(
      EMAIL_TEMPLATES[EMAIL_TEMPLATE_IDS.deviceRequestDocumentsTransmission]
    );
    expect(batchCommitMock).toHaveBeenCalledTimes(1);
  });

  it("denies an admin without the superAdmin flag, writes nothing", async () => {
    await expect(deployEmailTemplates.run(buildRequest("admin-1"))).rejects.toMatchObject(
      new HttpsError("permission-denied", "Only a super admin can perform this action")
    );
    expect(batchCommitMock).not.toHaveBeenCalled();
    expect(Object.keys(templatesStore)).toHaveLength(0);
  });

  it("throws unauthenticated when there is no auth context", async () => {
    await expect(deployEmailTemplates.run(buildRequest(null))).rejects.toMatchObject(
      new HttpsError("unauthenticated", "Authentication required")
    );
    expect(batchCommitMock).not.toHaveBeenCalled();
  });
});
