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

const templatesUpdateMock = jest.fn((updates: Record<string, unknown>) => {
  templatesStore[TEMPLATE_ID] = { ...templatesStore[TEMPLATE_ID], ...updates };
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
        update: templatesUpdateMock,
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
  FieldValue: { serverTimestamp: jest.fn(() => "SERVER_TIMESTAMP") },
}));

jest.mock("../security/securityLog", () => ({
  logSecurityEvent: jest.fn().mockResolvedValue(undefined),
}));

import { updateDeviceChecklistTemplate } from "./updateChecklistTemplate";

function buildRequest(data: Record<string, unknown>, uid: string | null = "admin-1"): CallableRequest {
  return {
    auth: uid ? ({ uid } as CallableRequest["auth"]) : undefined,
    data,
    rawRequest: { headers: {} } as CallableRequest["rawRequest"],
  } as CallableRequest;
}

describe("updateDeviceChecklistTemplate", () => {
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
        items: [{ title: "Stampa dita", quantity: 2 }],
      },
    };
  });

  it("delegates to the core updateTemplate and updates the template when the authenticated user is admin", async () => {
    const result = await updateDeviceChecklistTemplate.run(
      buildRequest({ templateId: TEMPLATE_ID, title: "Checklist Kinetic Hand v2" }, "admin-1")
    );

    expect(collectionMock).toHaveBeenCalledWith("users");
    expect(collectionMock).toHaveBeenCalledWith("templates");
    expect(templatesUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Checklist Kinetic Hand v2" })
    );
    expect(result).toEqual({ templateId: TEMPLATE_ID });
  });

  it("throws permission-denied and does not update the template when the authenticated user is not admin", async () => {
    await expect(
      updateDeviceChecklistTemplate.run(
        buildRequest({ templateId: TEMPLATE_ID, title: "Checklist Kinetic Hand v2" }, "volunteer-1")
      )
    ).rejects.toMatchObject(new HttpsError("permission-denied", "Only admin can manage checklist templates"));

    expect(templatesUpdateMock).not.toHaveBeenCalled();
  });

  it("throws unauthenticated when there is no auth context, without querying Firestore", async () => {
    await expect(
      updateDeviceChecklistTemplate.run(
        buildRequest({ templateId: TEMPLATE_ID, title: "Checklist Kinetic Hand v2" }, null)
      )
    ).rejects.toMatchObject(new HttpsError("unauthenticated", "Authentication required"));

    expect(collectionMock).not.toHaveBeenCalled();
    expect(templatesUpdateMock).not.toHaveBeenCalled();
  });

  it("propagates not-found from the core updateTemplate when the template does not exist", async () => {
    delete templatesStore[TEMPLATE_ID];

    await expect(
      updateDeviceChecklistTemplate.run(
        buildRequest({ templateId: TEMPLATE_ID, title: "Checklist Kinetic Hand v2" }, "admin-1")
      )
    ).rejects.toMatchObject(new HttpsError("not-found", "Template not found"));

    expect(templatesUpdateMock).not.toHaveBeenCalled();
  });
});
