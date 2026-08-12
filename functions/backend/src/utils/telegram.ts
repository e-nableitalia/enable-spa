import jwt from "jsonwebtoken";

/**
 * Invia un messaggio a un endpoint Telegram tramite API REST autenticata con JWT (HS256).
 *
 * F-20: `jose` (ESM-puro) sostituito con `jsonwebtoken` (CommonJS) — `jose`
 * rompeva il parsing Jest/ts-jest per qualunque test che importasse questo
 * modulo anche transitivamente (`SyntaxError: Unexpected token 'export'`),
 * richiedendo un mock esplicito. Stesso algoritmo (HS256) e stessa scadenza
 * (5 minuti), nessun cambio di comportamento verso l'endpoint Telegram.
 */
export async function sendTelegramMessage(
  apiUrl: string,
  secret: string,
  message: string
): Promise<any> {

  const token = jwt.sign({}, secret, { algorithm: "HS256", expiresIn: "5m" });

  const response = await fetch(apiUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ body: message }),
  });

  if (!response.ok) {
    throw new Error(`HTTP error ${response.status}`);
  }

  return await response.json();
}