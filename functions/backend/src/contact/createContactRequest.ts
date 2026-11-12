import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { verifyRecaptcha } from "../security/recaptcha";
import { checkContactRateLimit, checkIpRateLimit } from "../security/rateLimit";
import { logSecurityEvent } from "../security/securityLog";
import { getInvokeId } from "../utils/invoke";
import {
  contactRateLimitKey,
  isLikelyBot,
  validateContactRequest,
} from "./contactRequestValidation";

const REGION = "europe-west1";
const RECAPTCHA_ACTION = "create_contact_request";
const RECAPTCHA_MIN_SCORE = 0.6;

/**
 * Cloud Function callable per la form pubblica di richiesta contatto
 * (pagina `/contatti`).
 *
 * Passi:
 * - scarta in silenzio gli invii automatici (campo trappola `website`
 *   compilato o form inviata in meno di `MIN_FILL_TIME_MS`): risponde
 *   `{ success: true }` senza salvare, cosi' il bot non sa di essere stato
 *   fermato;
 * - verifica il token reCAPTCHA Enterprise (azione `create_contact_request`,
 *   soglia 0.6), che non richiede l'email;
 * - valida e normalizza i campi (`validateContactRequest`);
 * - applica il rate limit per IP (scope `contact`) e per contatto (email o
 *   telefono, chiave hashata);
 * - salva il contatto nella collection `contacts` con `origin: "contact-form"`
 *   e `status: "new"`.
 *
 * @returns `{ success: true }`
 * @throws HttpsError su token mancante o non valido, spam, dati non validi,
 * rate limit superato o errori interni.
 */
export const createContactRequest = onCall(
  {
    region: REGION,
    secrets: ["RECAPTCHA_API_KEY", "RECAPTCHA_SITE_KEY"],
  },
  async (request) => {
    const invokeId = getInvokeId(request);
    const data = (request.data ?? {}) as Record<string, unknown>;
    const ip = request.rawRequest?.ip ?? "unknown";

    try {
      if (isLikelyBot(data)) {
        console.log(`[createContactRequest] Invoke ID: ${invokeId} - bot heuristics matched, discarded`);
        await logSecurityEvent({
          type: "form",
          action: "contact_request_honeypot",
          outcome: "blocked",
          severity: "medium",
          actor: { ip },
          context: {
            function: "createContactRequest",
            invokeId,
            metadata: { elapsedMs: data.elapsedMs ?? null, honeypotFilled: Boolean(data.website) },
          },
        });
        return { success: true };
      }

      const recaptchaToken = data.recaptchaToken;
      if (typeof recaptchaToken !== "string" || !recaptchaToken) {
        throw new HttpsError("invalid-argument", "Missing recaptchaToken");
      }
      const apiKey = process.env.RECAPTCHA_API_KEY;
      const siteKey = process.env.RECAPTCHA_SITE_KEY;
      if (!apiKey || !siteKey) {
        console.log("[createContactRequest] KO: reCAPTCHA secrets are not set");
        throw new HttpsError("internal", "reCAPTCHA is not configured");
      }

      const { score, reasons } = await verifyRecaptcha(recaptchaToken, RECAPTCHA_ACTION, siteKey, apiKey);
      const blocked = score < RECAPTCHA_MIN_SCORE;
      await logSecurityEvent({
        type: "security",
        action: "contact_request_recaptcha",
        outcome: blocked ? "blocked" : "success",
        severity: blocked ? "high" : "low",
        actor: { ip },
        context: {
          function: "createContactRequest",
          invokeId,
          metadata: { score, reasons },
        },
      });
      if (blocked) {
        console.log(`[createContactRequest] KO: spam detected, score ${score}`);
        throw new HttpsError("permission-denied", "Spam detected");
      }

      const input = validateContactRequest(data);

      await checkIpRateLimit(ip, "contact");
      await checkContactRateLimit(contactRateLimitKey(input));

      const ref = getFirestore().collection("contacts").doc();
      await ref.set({
        firstName: input.firstName,
        lastName: input.lastName,
        email: input.email,
        phone: input.phone,
        profile: input.profile,
        profileOther: input.profileOther,
        description: input.description,
        source: input.source,
        origin: "contact-form",
        status: "new",
        consentPrivacy: true,
        recaptchaScore: score,
        deleted: false,
        receivedAt: FieldValue.serverTimestamp(),
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      console.log(`[createContactRequest] Invoke ID: ${invokeId} - contact ${ref.id} created`);

      return { success: true };
    } catch (error) {
      if (error instanceof HttpsError) throw error;
      console.error("[createContactRequest] KO: unexpected error", error);
      throw new HttpsError("internal", "Errore durante l'invio della richiesta di contatto");
    }
  }
);
