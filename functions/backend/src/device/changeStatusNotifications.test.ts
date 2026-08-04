const sendEmailToDeviceAdminsMock = jest.fn().mockResolvedValue(true);
const sendTelegramMessageMock = jest.fn().mockResolvedValue({ ok: true });

jest.mock("../utils/email", () => ({
  sendEmailToDeviceAdmins: (...args: unknown[]) => sendEmailToDeviceAdminsMock(...args),
}));

jest.mock("../utils/telegram", () => ({
  sendTelegramMessage: (...args: unknown[]) => sendTelegramMessageMock(...args),
}));

import { sendChangeStatusNotifications } from "./changeStatusNotifications";

/**
 * Store minimale che simula `publicDeviceRequests` (per la risoluzione del
 * `requestLabel`), `users` (email dei volontari assegnati) e `mail`
 * (accodamento email in stile Firestore Trigger Email extension).
 */
let publicDeviceRequestsStore: Record<string, Record<string, unknown> | undefined>;
let usersStore: Record<string, Record<string, unknown> | undefined>;
const mailAddMock = jest.fn().mockResolvedValue(undefined);

function buildDb() {
  return {
    collection: (name: string) => {
      if (name === "publicDeviceRequests") {
        return {
          doc: (id: string) => ({
            get: () =>
              Promise.resolve({
                data: () => publicDeviceRequestsStore[id],
              }),
          }),
        };
      }
      if (name === "users") {
        return {
          doc: (uid: string) => ({
            get: () =>
              Promise.resolve({
                data: () => usersStore[uid],
              }),
          }),
        };
      }
      if (name === "mail") {
        return {
          add: (doc: Record<string, unknown>) => mailAddMock(doc),
        };
      }
      throw new Error(`Unexpected collection ${name}`);
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

describe("sendChangeStatusNotifications", () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    publicDeviceRequestsStore = {};
    usersStore = {};
    process.env = { ...OLD_ENV };
  });

  afterAll(() => {
    process.env = OLD_ENV;
  });

  // Scenario: notifica admin abilitata su cambio di stato
  it("sends an admin email with the status-transition subject/body when currentStatus differs from newStatus", async () => {
    publicDeviceRequestsStore["req-1"] = { requestNumber: 42 };

    await sendChangeStatusNotifications({
      db: buildDb(),
      requestId: "req-1",
      requestData: {},
      currentStatus: "inviata",
      newStatus: "personalizzazione",
      notifica: { admin: true },
    });

    expect(sendEmailToDeviceAdminsMock).toHaveBeenCalledTimes(1);
    const [subject, html] = sendEmailToDeviceAdminsMock.mock.calls[0];
    expect(subject).toBe("[e-Nable] Richiesta #42: stato → personalizzazione");
    expect(html).toContain("è passata da <em>inviata</em> a <strong>personalizzazione</strong>");
    expect(sendTelegramMessageMock).not.toHaveBeenCalled();
    expect(mailAddMock).not.toHaveBeenCalled();
  });

  it("falls back to requestId as label when publicDeviceRequests has no requestNumber", async () => {
    await sendChangeStatusNotifications({
      db: buildDb(),
      requestId: "req-no-number",
      requestData: {},
      currentStatus: "inviata",
      newStatus: "personalizzazione",
      notifica: { admin: true },
    });

    const [subject] = sendEmailToDeviceAdminsMock.mock.calls[0];
    expect(subject).toBe("[e-Nable] Richiesta req-no-number: stato → personalizzazione");
  });

  // Scenario: notifica volontari abilitata
  it("queues one 'mail' entry per assigned volunteer that has an email in users/{uid}", async () => {
    usersStore["vol-1"] = { email: "vol1@example.com" };
    usersStore["vol-2"] = {}; // nessuna email valorizzata
    usersStore["vol-3"] = { email: "vol3@example.com" };

    await sendChangeStatusNotifications({
      db: buildDb(),
      requestId: "req-2",
      requestData: { assignedVolunteers: ["vol-1", "vol-2", "vol-3"] },
      currentStatus: "personalizzazione",
      newStatus: "attesa materiali",
      notifica: { volunteers: true },
    });

    expect(mailAddMock).toHaveBeenCalledTimes(2);
    expect(mailAddMock).toHaveBeenCalledWith(
      expect.objectContaining({ to: ["vol1@example.com"] })
    );
    expect(mailAddMock).toHaveBeenCalledWith(
      expect.objectContaining({ to: ["vol3@example.com"] })
    );
  });

  it("queues no volunteer email when assignedVolunteers is empty", async () => {
    await sendChangeStatusNotifications({
      db: buildDb(),
      requestId: "req-3",
      requestData: { assignedVolunteers: [] },
      currentStatus: "personalizzazione",
      newStatus: "attesa materiali",
      notifica: { volunteers: true },
    });

    expect(mailAddMock).not.toHaveBeenCalled();
  });

  // Scenario: notifica Telegram abilitata con secrets configurati
  it("sends a Telegram message built with the same status-transition text when secrets are configured", async () => {
    process.env.TELEGRAM_API_URL = "https://telegram.example/api";
    process.env.TELEGRAM_API_SECRET = "shh";

    await sendChangeStatusNotifications({
      db: buildDb(),
      requestId: "req-4",
      requestData: {},
      currentStatus: "attesa materiali",
      newStatus: "fabbricazione",
      notifica: { telegram: true },
    });

    expect(sendTelegramMessageMock).toHaveBeenCalledWith(
      "https://telegram.example/api",
      "shh",
      "Aggiornamento richiesta req-4: attesa materiali → fabbricazione"
    );
  });

  it("includes the note in the Telegram message when a note is provided alongside a status transition", async () => {
    process.env.TELEGRAM_API_URL = "https://telegram.example/api";
    process.env.TELEGRAM_API_SECRET = "shh";

    await sendChangeStatusNotifications({
      db: buildDb(),
      requestId: "req-4b",
      requestData: {},
      currentStatus: "attesa materiali",
      newStatus: "fabbricazione",
      note: "Materiali arrivati",
      notifica: { telegram: true },
    });

    expect(sendTelegramMessageMock).toHaveBeenCalledWith(
      "https://telegram.example/api",
      "shh",
      "Aggiornamento richiesta req-4b: Materiali arrivati (attesa materiali → fabbricazione)"
    );
  });

  // Scenario: notifica Telegram richiesta ma secrets non configurati
  it("sends no Telegram message and logs a warning when secrets are not configured", async () => {
    delete process.env.TELEGRAM_API_URL;
    delete process.env.TELEGRAM_API_SECRET;
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => undefined);

    await sendChangeStatusNotifications({
      db: buildDb(),
      requestId: "req-5",
      requestData: {},
      currentStatus: "attesa materiali",
      newStatus: "fabbricazione",
      notifica: { telegram: true },
    });

    expect(sendTelegramMessageMock).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      "Telegram notifica richiesta ma TELEGRAM_API_URL/TELEGRAM_API_SECRET non configurati"
    );

    warnSpy.mockRestore();
  });

  // Scenario: nota pura (stesso stato) produce testo di aggiornamento invece che di transizione
  it("uses the 'aggiornamento' wording instead of the status-transition one for a pure note (currentStatus === newStatus)", async () => {
    process.env.TELEGRAM_API_URL = "https://telegram.example/api";
    process.env.TELEGRAM_API_SECRET = "shh";
    publicDeviceRequestsStore["req-6"] = { requestNumber: 7 };

    await sendChangeStatusNotifications({
      db: buildDb(),
      requestId: "req-6",
      requestData: {},
      currentStatus: "fabbricazione",
      newStatus: "fabbricazione",
      notifica: { admin: true, telegram: true },
    });

    const [subject, html] = sendEmailToDeviceAdminsMock.mock.calls[0];
    expect(subject).toBe("[e-Nable] Richiesta #7: aggiornamento (stato: fabbricazione)");
    expect(html).toContain("è in stato <strong>fabbricazione</strong>");
    expect(html).not.toContain("stato →");
    expect(sendTelegramMessageMock).toHaveBeenCalledWith(
      "https://telegram.example/api",
      "shh",
      "Aggiornamento richiesta #7: stato corrente fabbricazione"
    );
  });

  it("includes the note in the pure-note Telegram message and does not block other channels when one job fails (Promise.allSettled)", async () => {
    process.env.TELEGRAM_API_URL = "https://telegram.example/api";
    process.env.TELEGRAM_API_SECRET = "shh";
    sendEmailToDeviceAdminsMock.mockRejectedValueOnce(new Error("smtp down"));

    await sendChangeStatusNotifications({
      db: buildDb(),
      requestId: "req-7",
      requestData: {},
      currentStatus: "fabbricazione",
      newStatus: "fabbricazione",
      note: "Ancora in lavorazione",
      notifica: { admin: true, telegram: true },
    });

    expect(sendTelegramMessageMock).toHaveBeenCalledWith(
      "https://telegram.example/api",
      "shh",
      "Aggiornamento richiesta req-7: Ancora in lavorazione (stato: fabbricazione)"
    );
  });
});
