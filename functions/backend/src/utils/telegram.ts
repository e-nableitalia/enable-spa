import jwt from "jsonwebtoken";

export type TelegramParseMode = "HTML" | "Markdown" | "MarkdownV2";

/**
 * Invia un messaggio a un endpoint Telegram tramite API REST autenticata con JWT (HS256).
 *
 * F-20: `jose` (ESM-puro) sostituito con `jsonwebtoken` (CommonJS) — `jose`
 * rompeva il parsing Jest/ts-jest per qualunque test che importasse questo
 * modulo anche transitivamente (`SyntaxError: Unexpected token 'export'`),
 * richiedendo un mock esplicito. Stesso algoritmo (HS256) e stessa scadenza
 * (5 minuti), nessun cambio di comportamento verso l'endpoint Telegram.
 *
 * Di default invia `parse_mode: "HTML"` così il gateway (n8n → Bot API) può
 * renderizzare `<b>`, `<i>`, `<a>` invece di mostrarli come testo grezzo.
 */
export async function sendTelegramMessage(
  apiUrl: string,
  secret: string,
  message: string,
  parseMode: TelegramParseMode = "HTML"
): Promise<any> {

  const token = jwt.sign({}, secret, { algorithm: "HS256", expiresIn: "5m" });

  const response = await fetch(apiUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ body: message, parse_mode: parseMode }),
  });

  if (!response.ok) {
    throw new Error(`HTTP error ${response.status}`);
  }

  return await response.json();
}
