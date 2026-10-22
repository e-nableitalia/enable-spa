/**
 * Profili del campo "Chi sei?" della form pubblica di contatto (`/contatti`).
 * I valori devono restare allineati a `CONTACT_PROFILES` in
 * `functions/backend/src/contact/contactRequestValidation.ts`.
 */
export const CONTACT_PROFILES = [
    { value: "maker", label: "Maker / appassionato di stampa 3D" },
    { value: "studente", label: "Studente" },
    { value: "docente_scuola", label: "Docente / Scuola" },
    { value: "universita_ricerca", label: "Università / Ricerca" },
    { value: "famiglia", label: "Famiglia o persona interessata a un device" },
    { value: "sanitario", label: "Professionista sanitario (terapista, medico, tecnico ortopedico)" },
    { value: "associazione_ente", label: "Associazione / Ente" },
    { value: "azienda_sponsor", label: "Azienda / Sponsor" },
    { value: "media", label: "Stampa / Media" },
    { value: "altro", label: "Altro" },
] as const;

export type ContactProfile = (typeof CONTACT_PROFILES)[number]["value"];

export function contactProfileLabel(value: unknown): string {
    return CONTACT_PROFILES.find((p) => p.value === value)?.label ?? "";
}

/** Profili per cui "Invita" (registrazione come volontario) non chiede conferma. */
export const VOLUNTEER_LIKE_PROFILES: readonly string[] = ["maker", "studente"];

export const CONTACT_MESSAGE_MAX_LENGTH = 2000;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_PATTERN = /^\+?[0-9 ()./-]{6,}$/;

export interface ContactFormValues {
    firstName: string;
    lastName: string;
    phone: string;
    email: string;
    profile: string;
    profileOther: string;
    description: string;
    consentPrivacy: boolean;
}

/** Ritorna il messaggio d'errore da mostrare, o null se la form e' valida. */
export function validateContactForm(form: ContactFormValues): string | null {
    if (!form.firstName.trim() || !form.lastName.trim()) {
        return "Inserisci nome e cognome";
    }
    const email = form.email.trim();
    const phone = form.phone.trim();
    if (!email && !phone) {
        return "Inserisci almeno un recapito: telefono o email";
    }
    if (email && !EMAIL_PATTERN.test(email)) {
        return "L'indirizzo email non è valido";
    }
    if (phone && !PHONE_PATTERN.test(phone)) {
        return "Il numero di telefono non è valido";
    }
    if (form.description.length > CONTACT_MESSAGE_MAX_LENGTH) {
        return `Il motivo del contatto può contenere al massimo ${CONTACT_MESSAGE_MAX_LENGTH} caratteri`;
    }
    if (!form.consentPrivacy) {
        return "Per inviare la richiesta devi accettare l'informativa privacy";
    }
    return null;
}

/** Il parametro `?src=` (es. dal QR code) viene inoltrato solo se ben formato. */
export function readContactSource(search: string): string | null {
    const src = new URLSearchParams(search).get("src");
    return src && /^[a-zA-Z0-9_-]{1,50}$/.test(src) ? src : null;
}

/** I contatti importati da CSV non hanno `origin`: valgono come "csv-import". */
export function contactOrigin(contact: { origin?: unknown }): string {
    return contact.origin === "contact-form" ? "contact-form" : "csv-import";
}

export const CONTACT_ORIGIN_LABELS: Record<string, string> = {
    "contact-form": "Form contatti",
    "csv-import": "Import CSV",
};

/**
 * Contatti che "Invita" (registrazione come volontario) non deve coinvolgere
 * senza conferma: arrivati dalla form pubblica con un profilo diverso da
 * maker o studente.
 */
export function contactsNeedingInviteConfirmation<T extends { origin?: unknown; profile?: unknown }>(contacts: T[]): T[] {
    return contacts.filter(
        (c) => contactOrigin(c) === "contact-form" && !VOLUNTEER_LIKE_PROFILES.includes(String(c.profile ?? ""))
    );
}
