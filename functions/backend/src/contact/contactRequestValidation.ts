import { HttpsError } from "firebase-functions/v2/https";

/**
 * Profili ammessi per il campo "Chi sei?" della form pubblica di contatto.
 * Deve restare allineato a `CONTACT_PROFILES` in
 * `enable-device/src/helpers/contactProfiles.ts`.
 */
export const CONTACT_PROFILES = [
  "maker",
  "studente",
  "docente_scuola",
  "universita_ricerca",
  "famiglia",
  "sanitario",
  "associazione_ente",
  "azienda_sponsor",
  "media",
  "altro",
] as const;

export type ContactProfile = (typeof CONTACT_PROFILES)[number];

/** Tempo minimo (ms) tra apertura della pagina e invio: sotto e' un bot. */
export const MIN_FILL_TIME_MS = 3000;

const MAX_NAME_LENGTH = 100;
const MAX_PHONE_LENGTH = 30;
const MAX_EMAIL_LENGTH = 254;
const MAX_PROFILE_OTHER_LENGTH = 100;
const MAX_SOURCE_LENGTH = 50;
export const MAX_MESSAGE_LENGTH = 2000;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_PATTERN = /^\+?[0-9 ()./-]{6,}$/;
const SOURCE_PATTERN = /^[a-zA-Z0-9_-]+$/;

export interface ContactRequestInput {
  firstName: string;
  lastName: string;
  phone: string | null;
  email: string | null;
  profile: ContactProfile | null;
  profileOther: string | null;
  description: string | null;
  source: string | null;
}

function cleanString(value: unknown, maxLength: number, field: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") {
    throw new HttpsError("invalid-argument", `Invalid field: ${field}`);
  }
  // Rimuove i caratteri di controllo (tranne a capo e tab) e gli spazi ai bordi.
  // eslint-disable-next-line no-control-regex
  const cleaned = value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim();
  if (cleaned.length === 0) return null;
  if (cleaned.length > maxLength) {
    throw new HttpsError("invalid-argument", `Field too long: ${field}`);
  }
  return cleaned;
}

/**
 * Valida e normalizza i dati della form pubblica di contatto.
 * Nome e cognome sono obbligatori, telefono ed email facoltativi ma almeno
 * uno dei due deve essere presente, il consenso privacy e' obbligatorio.
 */
export function validateContactRequest(data: Record<string, unknown>): ContactRequestInput {
  const firstName = cleanString(data.firstName, MAX_NAME_LENGTH, "firstName");
  const lastName = cleanString(data.lastName, MAX_NAME_LENGTH, "lastName");
  const phone = cleanString(data.phone, MAX_PHONE_LENGTH, "phone");
  const rawEmail = cleanString(data.email, MAX_EMAIL_LENGTH, "email");
  const email = rawEmail ? rawEmail.toLowerCase() : null;
  const profileOther = cleanString(data.profileOther, MAX_PROFILE_OTHER_LENGTH, "profileOther");
  const description = cleanString(data.description, MAX_MESSAGE_LENGTH, "description");
  const source = cleanString(data.source, MAX_SOURCE_LENGTH, "source");

  if (!firstName || !lastName) {
    throw new HttpsError("invalid-argument", "Missing required fields");
  }
  if (!phone && !email) {
    throw new HttpsError("invalid-argument", "Phone or email is required");
  }
  if (email && !EMAIL_PATTERN.test(email)) {
    throw new HttpsError("invalid-argument", "Invalid email");
  }
  if (phone && !PHONE_PATTERN.test(phone)) {
    throw new HttpsError("invalid-argument", "Invalid phone");
  }
  if (data.consentPrivacy !== true) {
    throw new HttpsError("invalid-argument", "Privacy consent is required");
  }

  let profile: ContactProfile | null = null;
  if (data.profile !== undefined && data.profile !== null && data.profile !== "") {
    if (!CONTACT_PROFILES.includes(data.profile as ContactProfile)) {
      throw new HttpsError("invalid-argument", "Invalid profile");
    }
    profile = data.profile as ContactProfile;
  }

  return {
    firstName,
    lastName,
    phone,
    email,
    profile,
    profileOther: profile === "altro" ? profileOther : null,
    description,
    source: source && SOURCE_PATTERN.test(source) ? source : null,
  };
}

/**
 * Chiave per il rate limit sul contatto: email se presente, altrimenti il
 * telefono ridotto alle sole cifre (cosi' "+39 333 1234567" e "+393331234567"
 * contano come lo stesso contatto).
 */
export function contactRateLimitKey(input: Pick<ContactRequestInput, "email" | "phone">): string {
  if (input.email) return `email:${input.email}`;
  return `phone:${(input.phone ?? "").replace(/\D/g, "")}`;
}

/**
 * Riconosce gli invii automatici: campo trappola compilato oppure form
 * inviata troppo in fretta rispetto all'apertura della pagina.
 */
export function isLikelyBot(data: Record<string, unknown>): boolean {
  if (typeof data.website === "string" && data.website.trim() !== "") return true;
  const elapsed = Number(data.elapsedMs);
  return !Number.isFinite(elapsed) || elapsed < MIN_FILL_TIME_MS;
}
