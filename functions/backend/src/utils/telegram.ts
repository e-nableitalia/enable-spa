import { SignJWT } from "jose";

/**
 * Invia un messaggio a un endpoint Telegram tramite API REST autenticata con JWT (HS256).
 */
export async function sendTelegramMessage(
  apiUrl: string,
  secret: string,
  message: string
): Promise<any> {

  const secretKey = new TextEncoder().encode(secret);

  // genera JWT
  const token = await new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("5m")
    .sign(secretKey);

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