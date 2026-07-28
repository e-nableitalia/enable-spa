import { HttpsError } from "firebase-functions/v2/https";
import type { CallableRequest } from "firebase-functions/v2/https";

const TEMPLATE_ID = "existing-template-id";

/**
 * Store in-memory minimale che simula le collection Firestore coinvolte:
 * `users` (per il controllo di ruolo) e `templates` (per la scrittura
 * delegata al core Organizer).
 */
let usersStore: Record<string, Record<string, unknown> | undefined>;
let templatesStore: Record<string, Record<string, unknown> | undefined>;

const templatesDeleteMock = jest.fn((id: string) => {
  delete templatesStore[id];
  return Promise.resolve();
});

function buildCollection(name: string) {
  if (name === "users") {
    return {
      doc: jest.fn((uid: string) => ({
        get: jest.fn(() =>
          Promise.resolve({
            exists: usersStore[uid] !== undefined,
            data: () => usersStore[uid],
          })
        ),
      })),
    };
  }

  if (name === "templates") {
    return {
      doc: jest.fn((id: string) => ({
        get: jest.fn(() =>
          Promise.resolve({
            exists: templatesStore[id] !== undefined,
            data: () => templatesStore[id],
          })
        ),
        delete: jest.fn(() => templatesDeleteMock(id)),
      })),
    };
  }

  throw new Error(`Unexpected collection ${name}`);
}

const collectionMock = jest.fn((name: string) => buildCollection(name));

jest.mock("firebase-admin/firestore", () => ({
  getFirestore: jest.fn(() => ({
    collection: (name: string) => collectionMock(name),
  })),
}));

jest.mock("../security/securityLog", () => ({
  logSecurityEvent: jest.fn().mockResolvedValue(undefined),
}));

import { deleteDeviceChecklistTemplate } from "./deleteChecklistTemplate";

function buildRequest(data: Record<string, unknown>, uid: string | null = "admin-1"): CallableRequest {
  return {
    auth: uid ? ({ uid } as CallableRequest["auth"]) : undefined,
    data,
    rawRequest: { headers: {} } as CallableRequest["rawRequest"],
  } as CallableRequest;
}

describe("deleteDeviceChecklistTemplate", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    usersStore = {
      "admin-1": { role: "admin" },
      "volunteer-1": { role: "volunteer" },
    };
    templatesStore = {
      [TEMPLATE_ID]: {
        category: "Kinetic Hand",
        title: "Checklist Kinetic Hand",
        items: [],
      },
    };
  });

  it("delegates to the core deleteTemplate and deletes the template when the authenticated user is admin", async () => {
    const result = await deleteDeviceChecklistTemplate.run(
      buildRequest({ templateId: TEMPLATE_ID }, "admin-1")
    );

    expect(collectionMock).toHaveBeenCalledWith("users");
    expect(collectionMock).toHaveBeenCalledWith("templates");
    expect(templatesDeleteMock).toHaveBeenCalledWith(TEMPLATE_ID);
    expect(templatesStore[TEMPLATE_ID]).toBeUndefined();
    expect(result).toEqual({ templateId: TEMPLATE_ID });
  });

  it("throws permission-denied and does not delete the template when the authenticated user is not admin", async () => {
    await expect(
      deleteDeviceChecklistTemplate.run(buildRequest({ templateId: TEMPLATE_ID }, "volunteer-1"))
    ).rejects.toMatchObject(new HttpsError("permission-denied", "Only admin can manage checklist templates"));

    expect(templatesDeleteMock).not.toHaveBeenCalled();
    expect(templatesStore[TEMPLATE_ID]).toBeDefined();
  });

  it("throws unauthenticated when there is no auth context, without querying Firestore", async () => {
    await expect(
      deleteDeviceChecklistTemplate.run(buildRequest({ templateId: TEMPLATE_ID }, null))
    ).rejects.toMatchObject(new HttpsError("unauthenticated", "Authentication required"));

    expect(collectionMock).not.toHaveBeenCalled();
    expect(templatesDeleteMock).not.toHaveBeenCalled();
  });

  it("propagates not-found from the core deleteTemplate when the template does not exist", async () => {
    delete templatesStore[TEMPLATE_ID];

    await expect(
      deleteDeviceChecklistTemplate.run(buildRequest({ templateId: TEMPLATE_ID }, "admin-1"))
    ).rejects.toMatchObject(new HttpsError("not-found", "Template not found"));

    expect(templatesDeleteMock).not.toHaveBeenCalled();
  });
});
