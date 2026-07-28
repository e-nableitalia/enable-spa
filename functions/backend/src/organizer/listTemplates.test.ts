import { HttpsError } from "firebase-functions/v2/https";
import type { CallableRequest } from "firebase-functions/v2/https";

const getMock = jest.fn();
const whereMock = jest.fn();
const collectionMock = jest.fn();

jest.mock("firebase-admin/firestore", () => ({
  getFirestore: jest.fn(() => ({
    collection: collectionMock,
  })),
}));

jest.mock("../security/securityLog", () => ({
  logSecurityEvent: jest.fn().mockResolvedValue(undefined),
}));

import { logSecurityEvent } from "../security/securityLog";
import { listTemplates } from "./listTemplates";

function buildRequest(data: Record<string, unknown>, uid: string | null = "user-1"): CallableRequest {
  return {
    auth: uid ? ({ uid } as CallableRequest["auth"]) : undefined,
    data,
    rawRequest: { headers: {} } as CallableRequest["rawRequest"],
  } as CallableRequest;
}

describe("listTemplates", () => {
  const CATEGORY = "devicetype-arto-superiore";

  const storedTemplates = [
    {
      id: "template-1",
      data: {
        category: CATEGORY,
        title: "Checklist stampa",
        items: [
          { title: "Prepara stampante", quantity: 2 },
          { title: "Verifica materiale", quantity: null },
        ],
      },
    },
    {
      id: "template-2",
      data: {
        category: CATEGORY,
        title: "Checklist consegna",
        items: [{ title: "Imballa dispositivo", quantity: 1 }],
      },
    },
  ];

  beforeEach(() => {
    jest.clearAllMocks();
    getMock.mockResolvedValue({
      docs: storedTemplates.map(({ id, data }) => ({
        id,
        data: () => data,
      })),
    });
    whereMock.mockReturnValue({ get: getMock });
    collectionMock.mockReturnValue({ where: whereMock });
  });

  it("returns all templates for the given category with id, title and items", async () => {
    const result = await listTemplates.run(buildRequest({ category: CATEGORY }));

    expect(collectionMock).toHaveBeenCalledWith("templates");
    expect(whereMock).toHaveBeenCalledWith("category", "==", CATEGORY);
    expect(getMock).toHaveBeenCalledTimes(1);

    expect(result).toEqual({
      templates: [
        {
          id: "template-1",
          title: "Checklist stampa",
          items: [
            { title: "Prepara stampante", quantity: 2 },
            { title: "Verifica materiale", quantity: null },
          ],
        },
        {
          id: "template-2",
          title: "Checklist consegna",
          items: [{ title: "Imballa dispositivo", quantity: 1 }],
        },
      ],
    });
  });

  it("returns an empty list when no template matches the category", async () => {
    getMock.mockResolvedValue({ docs: [] });

    const result = await listTemplates.run(buildRequest({ category: "devicetype-mano" }));

    expect(result).toEqual({ templates: [] });
  });

  it("throws unauthenticated when there is no auth context", async () => {
    await expect(
      listTemplates.run(buildRequest({ category: CATEGORY }, null))
    ).rejects.toMatchObject(new HttpsError("unauthenticated", "Authentication required"));

    expect(getMock).not.toHaveBeenCalled();
  });

  it("throws invalid-argument when category is missing", async () => {
    await expect(listTemplates.run(buildRequest({}))).rejects.toMatchObject(
      new HttpsError("invalid-argument", "Missing or invalid category")
    );

    expect(getMock).not.toHaveBeenCalled();
  });

  it("logs a success security event when templates are listed", async () => {
    await listTemplates.run(buildRequest({ category: CATEGORY }));

    expect(logSecurityEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "list_templates",
        outcome: "success",
        context: expect.objectContaining({ function: "listTemplates" }),
      })
    );
  });

  it("logs a failure security event when the category is missing", async () => {
    await expect(listTemplates.run(buildRequest({}))).rejects.toBeInstanceOf(HttpsError);

    expect(logSecurityEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "list_templates_failed",
        outcome: "failure",
        context: expect.objectContaining({ function: "listTemplates" }),
      })
    );
  });
});
