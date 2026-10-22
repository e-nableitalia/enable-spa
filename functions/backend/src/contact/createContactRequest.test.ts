import { HttpsError } from "firebase-functions/v2/https";
import type { CallableRequest } from "firebase-functions/v2/https";

const SERVER_TIMESTAMP_SENTINEL = { __type: "serverTimestamp" };

/**
 * Store in-memory minimale: `contacts` (documenti creati dalla form) e
 * `rateLimits` (contatori del rate limit, `security/rateLimit.ts` reale).
 */
let contactsStore: Record<string, Record<string, unknown>>;
let rateLimitsStore: Record<string, Record<string, unknown>>;
let nextContactId = 0;

function buildDoc(store: Record<string, Record<string, unknown>>, id: string) {
  return {
    id,
    get: jest.fn(() =>
      Promise.resolve({ exists: store[id] !== undefined, data: () => store[id] })
    ),
    set: jest.fn((data: Record<string, unknown>) => {
      store[id] = data;
      return Promise.resolve();
    }),
    update: jest.fn((data: Record<string, unknown>) => {
      store[id] = { ...store[id], ...data };
      return Promise.resolve();
    }),
  };
}

jest.mock("firebase-admin/firestore", () => ({
  getFirestore: jest.fn(() => ({
    collection: (name: string) => {
      if (name === "contacts") {
        return { doc: jest.fn(() => buildDoc(contactsStore, `contact-${++nextContactId}`)) };
      }
      if (name === "rateLimits") {
        return { doc: jest.fn((id: string) => buildDoc(rateLimitsStore, id)) };
      }
      throw new Error(`Unexpected collection ${name}`);
    },
  })),
  FieldValue: {
    serverTimestamp: jest.fn(() => SERVER_TIMESTAMP_SENTINEL),
  },
}));

const verifyRecaptchaMock = jest.fn();
jest.mock("../security/recaptcha", () => ({
  verifyRecaptcha: (...args: unknown[]) => verifyRecaptchaMock(...args),
}));

const logSecurityEventMock = jest.fn().mockResolvedValue(undefined);
jest.mock("../security/securityLog", () => ({
  logSecurityEvent: (...args: unknown[]) => logSecurityEventMock(...args),
}));

import { createContactRequest } from "./createContactRequest";

function buildRequest(data: Record<string, unknown>, ip = "1.2.3.4"): CallableRequest {
  return {
    data,
    rawRequest: { headers: {}, ip } as unknown as CallableRequest["rawRequest"],
  } as CallableRequest;
}

function validData(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    firstName: " Mario ",
    lastName: "Rossi",
    email: "Mario.Rossi@Example.com",
    phone: "",
    profile: "docente_scuola",
    description: "Vorremmo organizzare un laboratorio a scuola",
    consentPrivacy: true,
    source: "qr",
    website: "",
    elapsedMs: 15000,
    recaptchaToken: "token",
    ...overrides,
  };
}

async function expectHttpsError(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toBeInstanceOf(HttpsError);
  await promise.catch((err: HttpsError) => expect(err.code).toBe(code));
}

describe("createContactRequest", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    contactsStore = {};
    rateLimitsStore = {};
    nextContactId = 0;
    process.env.RECAPTCHA_API_KEY = "api-key";
    process.env.RECAPTCHA_SITE_KEY = "site-key";
    verifyRecaptchaMock.mockResolvedValue({ score: 0.9, reasons: [] });
  });

  it("saves a new contact from the public form in contacts", async () => {
    const result = await createContactRequest.run(buildRequest(validData()));

    expect(result).toEqual({ success: true });
    expect(verifyRecaptchaMock).toHaveBeenCalledWith("token", "create_contact_request", "site-key", "api-key");
    expect(Object.values(contactsStore)).toEqual([
      {
        firstName: "Mario",
        lastName: "Rossi",
        email: "mario.rossi@example.com",
        phone: null,
        profile: "docente_scuola",
        profileOther: null,
        description: "Vorremmo organizzare un laboratorio a scuola",
        source: "qr",
        origin: "contact-form",
        status: "new",
        consentPrivacy: true,
        recaptchaScore: 0.9,
        deleted: false,
        receivedAt: SERVER_TIMESTAMP_SENTINEL,
        createdAt: SERVER_TIMESTAMP_SENTINEL,
        updatedAt: SERVER_TIMESTAMP_SENTINEL,
      },
    ]);
  });

  it("accepts a phone without email and keeps profileOther only for 'altro'", async () => {
    await createContactRequest.run(
      buildRequest(validData({ email: undefined, phone: "+39 333 1234567", profile: "altro", profileOther: "Fotografo" }))
    );

    const [saved] = Object.values(contactsStore);
    expect(saved).toMatchObject({ email: null, phone: "+39 333 1234567", profile: "altro", profileOther: "Fotografo" });
  });

  it("rejects a request without phone and email", async () => {
    await expectHttpsError(
      createContactRequest.run(buildRequest(validData({ email: "", phone: "  " }))),
      "invalid-argument"
    );
    expect(contactsStore).toEqual({});
  });

  it("rejects a request without privacy consent", async () => {
    await expectHttpsError(
      createContactRequest.run(buildRequest(validData({ consentPrivacy: false }))),
      "invalid-argument"
    );
    expect(contactsStore).toEqual({});
  });

  it("rejects an unknown profile and an overlong message", async () => {
    await expectHttpsError(
      createContactRequest.run(buildRequest(validData({ profile: "hacker" }))),
      "invalid-argument"
    );
    await expectHttpsError(
      createContactRequest.run(buildRequest(validData({ description: "x".repeat(2001) }))),
      "invalid-argument"
    );
    expect(contactsStore).toEqual({});
  });

  it("silently discards submissions with the honeypot filled or sent too fast", async () => {
    await expect(createContactRequest.run(buildRequest(validData({ website: "http://spam" })))).resolves.toEqual({
      success: true,
    });
    await expect(createContactRequest.run(buildRequest(validData({ elapsedMs: 500 })))).resolves.toEqual({
      success: true,
    });

    expect(contactsStore).toEqual({});
    expect(verifyRecaptchaMock).not.toHaveBeenCalled();
    expect(logSecurityEventMock).toHaveBeenCalledTimes(2);
    expect(logSecurityEventMock.mock.calls[0][0]).toMatchObject({
      action: "contact_request_honeypot",
      outcome: "blocked",
    });
  });

  it("blocks low reCAPTCHA scores and logs the event", async () => {
    verifyRecaptchaMock.mockResolvedValue({ score: 0.3, reasons: ["AUTOMATION"] });

    await expectHttpsError(createContactRequest.run(buildRequest(validData())), "permission-denied");

    expect(contactsStore).toEqual({});
    expect(logSecurityEventMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: "contact_request_recaptcha", outcome: "blocked" })
    );
  });

  it("rejects a missing reCAPTCHA token", async () => {
    await expectHttpsError(
      createContactRequest.run(buildRequest(validData({ recaptchaToken: undefined }))),
      "invalid-argument"
    );
  });

  it("rate limits the same contact and stores only hashed keys", async () => {
    await createContactRequest.run(buildRequest(validData(), "1.1.1.1"));
    await expectHttpsError(
      createContactRequest.run(buildRequest(validData(), "2.2.2.2")),
      "resource-exhausted"
    );

    expect(Object.keys(contactsStore)).toHaveLength(1);
    const keys = Object.keys(rateLimitsStore);
    expect(keys.some((k) => k.startsWith("contact_"))).toBe(true);
    expect(keys.some((k) => k.startsWith("ip_contact_"))).toBe(true);
    expect(keys.join(" ")).not.toContain("example.com");
  });

  it("rate limits the same IP separately from the device request form", async () => {
    rateLimitsStore = {};
    for (let i = 0; i < 3; i++) {
      await createContactRequest.run(buildRequest(validData({ email: `user${i}@example.com` }), "9.9.9.9"));
    }
    await expectHttpsError(
      createContactRequest.run(buildRequest(validData({ email: "user9@example.com" }), "9.9.9.9")),
      "resource-exhausted"
    );
    expect(Object.keys(rateLimitsStore).some((k) => /^ip_[0-9a-f]{64}$/.test(k))).toBe(false);
  });
});
