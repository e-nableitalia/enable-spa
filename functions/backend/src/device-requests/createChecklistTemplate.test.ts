import { HttpsError } from "firebase-functions/v2/https";
import type { CallableRequest } from "firebase-functions/v2/https";

const GENERATED_TEMPLATE_ID = "generated-template-id";

/**
 * Store in-memory minimale che simula le collection Firestore coinvolte:
 * `users` (per il controllo di ruolo) e `templates` (per la scrittura
 * delegata al core Organizer).
 */
let usersStore: Record<string, Record<string, unknown> | undefined>;

const templatesSetMock = jest.fn(() => Promise.resolve());

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
      doc: jest.fn(() => ({
        id: GENERATED_TEMPLATE_ID,
        set: templatesSetMock,
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

import { createDeviceChecklistTemplate } from "./createChecklistTemplate";

function buildRequest(data: Record<string, unknown>, uid: string | null = "admin-1"): CallableRequest {
  return {
    auth: uid ? ({ uid } as CallableRequest["auth"]) : undefined,
    data,
    rawRequest: { headers: {} } as CallableRequest["rawRequest"],
  } as CallableRequest;
}

describe("createDeviceChecklistTemplate", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    usersStore = {
      "admin-1": { role: "admin" },
      "volunteer-1": { role: "volunteer" },
    };
  });

  it("delegates to the core createTemplate and creates the template when the authenticated user is admin", async () => {
    const result = await createDeviceChecklistTemplate.run(
      buildRequest(
        { category: "Kinetic Hand", title: "Checklist Kinetic Hand", items: ["Stampa dita"] },
        "admin-1"
      )
    );

    expect(collectionMock).toHaveBeenCalledWith("users");
    expect(collectionMock).toHaveBeenCalledWith("templates");
    expect(templatesSetMock).toHaveBeenCalledWith(
      expect.objectContaining({
        category: "Kinetic Hand",
        title: "Checklist Kinetic Hand",
        items: [{ title: "Stampa dita", quantity: null }],
      })
    );
    expect(result).toEqual({ templateId: GENERATED_TEMPLATE_ID });
  });

  it("throws permission-denied and does not create the template when the authenticated user is not admin", async () => {
    await expect(
      createDeviceChecklistTemplate.run(
        buildRequest(
          { category: "Kinetic Hand", title: "Checklist Kinetic Hand" },
          "volunteer-1"
        )
      )
    ).rejects.toMatchObject(new HttpsError("permission-denied", "Only admin can manage checklist templates"));

    expect(templatesSetMock).not.toHaveBeenCalled();
  });

  it("throws permission-denied when the authenticated user has no users/{uid} document", async () => {
    await expect(
      createDeviceChecklistTemplate.run(
        buildRequest({ category: "Kinetic Hand", title: "Checklist Kinetic Hand" }, "unknown-1")
      )
    ).rejects.toMatchObject(new HttpsError("permission-denied", "Only admin can manage checklist templates"));

    expect(templatesSetMock).not.toHaveBeenCalled();
  });

  it("throws unauthenticated when there is no auth context, without querying Firestore", async () => {
    await expect(
      createDeviceChecklistTemplate.run(
        buildRequest({ category: "Kinetic Hand", title: "Checklist Kinetic Hand" }, null)
      )
    ).rejects.toMatchObject(new HttpsError("unauthenticated", "Authentication required"));

    expect(collectionMock).not.toHaveBeenCalled();
    expect(templatesSetMock).not.toHaveBeenCalled();
  });

  it("propagates invalid-argument from the core createTemplate when the category is missing", async () => {
    await expect(
      createDeviceChecklistTemplate.run(
        buildRequest({ title: "Checklist senza categoria" }, "admin-1")
      )
    ).rejects.toMatchObject(new HttpsError("invalid-argument", "Missing or invalid category"));

    expect(templatesSetMock).not.toHaveBeenCalled();
  });
});
