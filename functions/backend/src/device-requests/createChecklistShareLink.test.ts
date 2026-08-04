import { HttpsError } from "firebase-functions/v2/https";
import type { CallableRequest } from "firebase-functions/v2/https";

const CHECKLIST_ID = "checklist-1";
const CHECKLIST_ID_2 = "checklist-2";
const GENERATED_TOKEN = "generated-token-uuid";

jest.mock("crypto", () => ({
  ...jest.requireActual("crypto"),
  randomUUID: jest.fn(() => GENERATED_TOKEN),
}));

/**
 * Store in-memory minimale che simula le collection Firestore coinvolte:
 * `users` (RBAC), `deviceRequests` (risoluzione `requestId` ->
 * `checklistId` + `assignedVolunteers`) e `checklistShareLinks` (token
 * persistiti lato server).
 */
let usersStore: Record<string, Record<string, unknown> | undefined>;
let deviceRequestsStore: Record<string, Record<string, unknown> | undefined>;
let shareLinksStore: Record<string, Record<string, unknown> | undefined>;

const shareLinkSetMock = jest.fn((token: string, doc: Record<string, unknown>) => {
  shareLinksStore[token] = doc;
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

  if (name === "deviceRequests") {
    return {
      doc: jest.fn((id: string) => ({
        get: jest.fn(() =>
          Promise.resolve({
            exists: deviceRequestsStore[id] !== undefined,
            data: () => deviceRequestsStore[id],
          })
        ),
      })),
    };
  }

  if (name === "checklistShareLinks") {
    return {
      doc: jest.fn((token: string) => ({
        set: jest.fn((doc: Record<string, unknown>) => shareLinkSetMock(token, doc)),
      })),
      where: jest.fn((field: string, _op: string, value: unknown) => ({
        limit: jest.fn(() => ({
          get: jest.fn(() => {
            const matches = Object.entries(shareLinksStore).filter(
              ([, data]) => data !== undefined && (data as Record<string, unknown>)[field] === value
            );
            return Promise.resolve({
              empty: matches.length === 0,
              docs: matches.map(([id, data]) => ({ id, data: () => data })),
            });
          }),
        })),
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

import { createChecklistShareLink } from "./createChecklistShareLink";
import { randomUUID } from "crypto";

function buildRequest(data: Record<string, unknown>, uid: string | null = "admin-1"): CallableRequest {
  return {
    auth: uid ? ({ uid } as CallableRequest["auth"]) : undefined,
    data,
    rawRequest: { headers: {} } as CallableRequest["rawRequest"],
  } as CallableRequest;
}

describe("createChecklistShareLink", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    shareLinksStore = {};

    usersStore = {
      "admin-1": { role: "admin" },
      "volunteer-1": { role: "volunteer" },
      "volunteer-2": { role: "volunteer" },
    };

    deviceRequestsStore = {
      "req-1": {
        assignedVolunteers: ["volunteer-1"],
        checklistIds: [CHECKLIST_ID],
      },
      "req-multi": {
        assignedVolunteers: ["volunteer-1"],
        checklistIds: [CHECKLIST_ID, CHECKLIST_ID_2],
      },
      "req-legacy": {
        assignedVolunteers: ["volunteer-1"],
        checklistId: CHECKLIST_ID,
      },
    };
  });

  // Scenario 1 (EA-132): Un admin genera un link per una checklist specifica di una richiesta.
  it("creates a persisted token linked to the checklist and returns a URL usable without auth (admin)", async () => {
    const result = await createChecklistShareLink.run(
      buildRequest({ requestId: "req-1", checklistId: CHECKLIST_ID }, "admin-1")
    );

    expect(result).toEqual({
      token: GENERATED_TOKEN,
      url: `https://app.e-nableitalia.it/checklist-share/${GENERATED_TOKEN}`,
    });
    expect(shareLinkSetMock).toHaveBeenCalledWith(
      GENERATED_TOKEN,
      expect.objectContaining({ checklistId: CHECKLIST_ID, requestId: "req-1", createdBy: "admin-1" })
    );
  });

  it("allows a volunteer assigned to the request to generate the link", async () => {
    const result = await createChecklistShareLink.run(
      buildRequest({ requestId: "req-1", checklistId: CHECKLIST_ID }, "volunteer-1")
    );

    expect(result.token).toBe(GENERATED_TOKEN);
    expect(shareLinkSetMock).toHaveBeenCalled();
  });

  it("denies generation to a volunteer not assigned to the request", async () => {
    await expect(
      createChecklistShareLink.run(buildRequest({ requestId: "req-1", checklistId: CHECKLIST_ID }, "volunteer-2"))
    ).rejects.toMatchObject(
      new HttpsError("permission-denied", "Only admin or assigned volunteers can access the checklist for this request")
    );

    expect(shareLinkSetMock).not.toHaveBeenCalled();
  });

  // Scenario 3 (EA-131) / Scenario 4 (EA-132): checklistId non appartenente a checklistIds -> not-found.
  it("throws not-found when checklistId does not belong to checklistIds of the request", async () => {
    await expect(
      createChecklistShareLink.run(buildRequest({ requestId: "req-1", checklistId: "other-checklist" }, "admin-1"))
    ).rejects.toMatchObject(new HttpsError("not-found", "Checklist not linked to this device request"));

    expect(shareLinkSetMock).not.toHaveBeenCalled();
  });

  // Scenario 5 (EA-133): nessun dual-read sul vecchio campo singolare
  // checklistId -> not-found, anche se il campo legacy e' ancora presente.
  it("throws not-found for a legacy request with only the singular checklistId field, no fallback", async () => {
    await expect(
      createChecklistShareLink.run(
        buildRequest({ requestId: "req-legacy", checklistId: CHECKLIST_ID }, "volunteer-1")
      )
    ).rejects.toMatchObject(new HttpsError("not-found", "Checklist not linked to this device request"));
  });

  // Scenario 2 (EA-132): due checklistId distinti della stessa richiesta,
  // ciascuno senza link esistente -> due token distinti, indipendenti,
  // ciascuno legato al proprio checklistId (1 link per checklist, non per richiesta).
  it("creates two independent tokens, one per checklistId, when generating links for two checklists of the same request", async () => {
    let uuidCallCount = 0;
    (randomUUID as jest.Mock).mockImplementation(() => `uuid-${++uuidCallCount}`);

    const firstResult = await createChecklistShareLink.run(
      buildRequest({ requestId: "req-multi", checklistId: CHECKLIST_ID }, "admin-1")
    );
    const secondResult = await createChecklistShareLink.run(
      buildRequest({ requestId: "req-multi", checklistId: CHECKLIST_ID_2 }, "admin-1")
    );

    expect(firstResult.token).not.toBe(secondResult.token);
    expect(shareLinkSetMock).toHaveBeenCalledWith(
      firstResult.token,
      expect.objectContaining({ checklistId: CHECKLIST_ID, requestId: "req-multi" })
    );
    expect(shareLinkSetMock).toHaveBeenCalledWith(
      secondResult.token,
      expect.objectContaining({ checklistId: CHECKLIST_ID_2, requestId: "req-multi" })
    );
    expect(shareLinksStore[firstResult.token]).toMatchObject({ checklistId: CHECKLIST_ID });
    expect(shareLinksStore[secondResult.token]).toMatchObject({ checklistId: CHECKLIST_ID_2 });

    // jest.clearAllMocks() (beforeEach) non ripristina mockImplementation: restore esplicito
    // per non far trapelare questa implementazione custom ai test successivi dello stesso file.
    (randomUUID as jest.Mock).mockImplementation(() => GENERATED_TOKEN);
  });

  it("reuses the existing token instead of creating a new one when a link already exists for the checklist", async () => {
    shareLinksStore = {
      "existing-token": { checklistId: CHECKLIST_ID, requestId: "req-1" },
    };

    const result = await createChecklistShareLink.run(
      buildRequest({ requestId: "req-1", checklistId: CHECKLIST_ID }, "admin-1")
    );

    expect(result).toEqual({
      token: "existing-token",
      url: "https://app.e-nableitalia.it/checklist-share/existing-token",
    });
    expect(shareLinkSetMock).not.toHaveBeenCalled();
  });

  it("throws unauthenticated when there is no auth context", async () => {
    await expect(
      createChecklistShareLink.run(buildRequest({ requestId: "req-1", checklistId: CHECKLIST_ID }, null))
    ).rejects.toMatchObject(new HttpsError("unauthenticated", "User must be authenticated"));

    expect(collectionMock).not.toHaveBeenCalled();
  });

  it("throws invalid-argument when requestId is missing", async () => {
    await expect(
      createChecklistShareLink.run(buildRequest({ checklistId: CHECKLIST_ID }, "admin-1"))
    ).rejects.toMatchObject(new HttpsError("invalid-argument", "Missing parameter: requestId"));
  });

  // Scenario 2 (EA-131) / Scenario 3 (EA-132): vecchio contratto (solo requestId, senza checklistId) -> invalid-argument.
  it("throws invalid-argument when checklistId is missing", async () => {
    await expect(
      createChecklistShareLink.run(buildRequest({ requestId: "req-1" }, "admin-1"))
    ).rejects.toMatchObject(new HttpsError("invalid-argument", "Missing parameter: checklistId"));
  });

  it("throws not-found when the device request does not exist", async () => {
    await expect(
      createChecklistShareLink.run(buildRequest({ requestId: "missing-request", checklistId: CHECKLIST_ID }, "admin-1"))
    ).rejects.toMatchObject(new HttpsError("not-found", "Device request not found"));
  });
});
