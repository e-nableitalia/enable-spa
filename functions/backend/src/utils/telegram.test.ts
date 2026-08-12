/**
 * Nessun mock di `jsonwebtoken` qui, deliberatamente: prima di F-20 questo
 * modulo importava `jose` (ESM-puro), che rompeva il parsing Jest/ts-jest
 * per qualunque test che lo importasse anche transitivamente
 * (`SyntaxError: Unexpected token 'export'`) — la sola importazione pulita
 * di `sendTelegramMessage`, senza alcun workaround, è la prova di
 * regressione che il problema è risolto.
 */
import { sendTelegramMessage } from "./telegram";

describe("sendTelegramMessage", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("posts a signed JWT bearer token and the message body to the given endpoint", async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ ok: true }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    await sendTelegramMessage("https://example.com/hook", "shared-secret", "Ciao");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe("https://example.com/hook");
    expect(options.method).toBe("POST");
    expect(options.headers["Content-Type"]).toBe("application/json");
    expect(options.headers.Authorization).toMatch(/^Bearer .+\..+\..+$/); // JWT: header.payload.signature
    expect(JSON.parse(options.body)).toEqual({ body: "Ciao" });
  });

  it("throws when the endpoint responds with a non-ok status", async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 500 }) as unknown as typeof fetch;

    await expect(sendTelegramMessage("https://example.com/hook", "secret", "Ciao")).rejects.toThrow(
      "HTTP error 500"
    );
  });
});
