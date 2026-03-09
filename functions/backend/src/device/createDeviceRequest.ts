import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { mapToPublicStatus } from "../utils/mapToPublicStatus";
import { verifyRecaptcha } from "../security/recaptcha";
import { checkEmailRateLimit, checkIpRateLimit } from "../security/rateLimit";
import { logSecurityEvent } from "../security/securityLog";
import { getInvokeId } from "../utils/invoke";
import { sendEmailToDeviceAdmins } from "../utils/email";

const REGION = "europe-west1";

/**
 * Cloud Function to handle device request creation from a public form.
 *
 * Performs the following steps:
 * - Validates reCAPTCHA token and email presence.
 * - Verifies reCAPTCHA score to prevent spam.
 * - Logs security events for reCAPTCHA and email actions.
 * - Checks rate limits for email and IP to prevent abuse.
 * - Validates required fields for device request.
 * - Creates a new device request document in Firestore, including:
 *   - Main request data.
 *   - Private user data.
 *   - Initial status change event.
 *   - Public device request reference.
 * - Enqueues a confirmation email for the requester.
 * - Handles and logs errors appropriately.
 *
 * @param request The callable request object containing form data and metadata.
 * @returns An object indicating success (`{ success: true }`) if the request is created.
 * @throws HttpsError If validation fails, spam is detected, or internal errors occur.
 *
 * @remarks
 * `requestRef.id` is the unique identifier (document ID) of the newly created device request in Firestore.
 */
export const createDeviceRequest = onCall(
  {
    region: REGION,
    secrets: [
      "RECAPTCHA_API_KEY",
      "RECAPTCHA_SITE_KEY",
      "MAILJET_API_KEY",
      "MAILJET_API_SECRET",
      "MAIL_FROM_ADDRESS"
    ]
  },
  async (request) => {
    const invokeId = getInvokeId(request);
    console.log(`[createDeviceRequest] Invoke ID: ${invokeId} - Function called`);
    try {
      console.log("[createDeviceRequest] called");
      const data = request.data;

      // --- ADDED: reCAPTCHA and rate limit checks ---
      const { recaptchaToken, email } = data;

      if (!recaptchaToken) {
        console.log("[createDeviceRequest] KO: Missing recaptchaToken");
        throw new HttpsError("invalid-argument", "Missing recaptchaToken");
      }
      if (!email) {
        console.log("[createDeviceRequest] KO: Missing email");
        throw new HttpsError("invalid-argument", "Missing email");
      }
      const apiKey = process.env.RECAPTCHA_API_KEY;
      const siteKey = process.env.RECAPTCHA_SITE_KEY;
      if (!apiKey) {
        console.log("[createDeviceRequest] KO: RECAPTCHA_API_KEY is not set");
        throw new HttpsError("internal", "RECAPTCHA_API_KEY is not set");
      }
      if (!siteKey) {
        console.log("[createDeviceRequest] KO: RECAPTCHA_SITE_KEY is not set");
        throw new HttpsError("internal", "RECAPTCHA_SITE_KEY is not set");
      }

      const ip = request.rawRequest?.ip ?? "unknown";

      console.log(`[createDeviceRequest] Verifying reCAPTCHA for email ${email}, ip ${ip}`);
      const { score, reasons } = await verifyRecaptcha(
        recaptchaToken,
        "create_device_request",
        siteKey,
        apiKey
      );
      console.log(`[createDeviceRequest] reCAPTCHA score: ${score}, reasons: ${reasons.join(", ")}`);
      await logSecurityEvent({
        type: "security",
        action: "device_request_recaptcha",
        outcome: score < 0.6 ? "blocked" : "success",
        severity: score < 0.6 ? "high" : "low",
        actor: {
          email,
          ip,
        },
        context: {
          function: "createDeviceRequest",
          invokeId: invokeId,
          metadata: {
            score,
            reasons,
          },
        },
      });
      if (score < 0.6) {
        console.log("[createDeviceRequest] KO: Spam detected");
        throw new HttpsError("permission-denied", "Spam detected");
      }

      console.log(`[createDeviceRequest] Checking rate limits for email ${email} and IP ${ip}`);
      await checkEmailRateLimit(email);
      await checkIpRateLimit(ip);
      // --- END ADDED ---

      if (
        !data.email ||
        !data.firstName ||
        !data.lastName ||
        !data.phone ||
        !data.province ||
        !data.amputationType ||
        !data.consentPrivacy
      ) {
        console.log("[createDeviceRequest] KO: Missing required fields");
        throw new HttpsError("invalid-argument", "Missing required fields");
      }

      const db = getFirestore();
      const requestRef = db.collection("deviceRequests").doc();

      console.log(`[createDeviceRequest] Creating device request document ${requestRef.id}`);
      await db.runTransaction(async (tx) => {
        tx.set(requestRef, {
          age: data.age || null,
          gender: data.gender || null,
          status: "inviata",
          publicStatus: mapToPublicStatus("inviata"),
          assignedVolunteer: null,
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
          createdBy: "public-form"
        });

        tx.set(requestRef.collection("private").doc("data"), {
          email: data.email,
          firstName: data.firstName || null,
          lastName: data.lastName || null,
          phone: data.phone || null,
          relation: data.relation || null,
          province: data.province,
          therapy: data.therapy || false,
          amputationType: data.amputationType,
          description: data.description || null,
          preferences: data.preferences || null,
          consentPrivacy: data.consentPrivacy || false
        });

        tx.set(requestRef.collection("events").doc(), {
          type: "status_change",
          fromStatus: null,
          toStatus: "inviata",
          timestamp: FieldValue.serverTimestamp(),
          createdBy: "system",
          note: "Richiesta creata da form pubblica"
        });

        tx.set(
          db.collection("publicDeviceRequests").doc(requestRef.id),
          {
            province: data.province,
            publicStatus: mapToPublicStatus("inviata"),
            createdAt: FieldValue.serverTimestamp()
          }
        );
      });

      // --- Send confirmation email ---
      try {
        const emailDoc = {
          to: data.email,
          template: "confermaRicezione",
          data: {
            firstName: data.firstName,
            lastName: data.lastName
          },
          createdAt: FieldValue.serverTimestamp()
        };
        await db.collection("emails").add(emailDoc);
        console.log(`[createDeviceRequest] Confirmation email enqueued for ${data.email}`);
        await logSecurityEvent({
          type: "system",
          action: "email_enqueued",
          outcome: "success",
          severity: "low",
          actor: {
            email: data.email,
            ip,
          },
          context: {
            function: "createDeviceRequest",
            invokeId: invokeId,
            requestId: requestRef.id,
          },
        });
      } catch (emailError) {
        console.error("[createDeviceRequest] KO: Failed to enqueue confirmation email", emailError);
        // Non blocca la richiesta, logga solo l'errore
      }

      await sendEmailToDeviceAdmins(
        "Nuova richiesta dispositivo",
        `<div>
          <h2>Nuova richiesta device</h2>
          <ul>
            <li><strong>Email:</strong> ${data.email}</li>
            <li><strong>Nome:</strong> ${data.firstName}</li>
            <li><strong>Cognome:</strong> ${data.lastName}</li>
            <li><strong>Telefono:</strong> ${data.phone}</li>
            <li><strong>Provincia:</strong> ${data.province}</li>
            <li><strong>Relazione:</strong> ${data.relation || "-"}</li>
            <li><strong>Descrizione:</strong> ${data.description || "-"}</li>
            <li><strong>Preferenze:</strong> ${data.preferences || "-"}</li>
          </ul>
        </div>`
      );

      console.log(`[createDeviceRequest] OK: device request ${requestRef.id} created`);
      return { success: true };
    } catch (error) {
      console.error("[createDeviceRequest] KO:", error);

      await logSecurityEvent({
        type: "system",
        action: "create_device_request_failed",
        outcome: "failure",
        severity: "high",
        actor: {
          email: request?.data?.email,
          ip: request?.rawRequest?.ip ?? "unknown",
        },
        context: {
          function: "createDeviceRequest",
          invokeId: invokeId,
        },
      });

      if (error instanceof HttpsError) {
        throw error;
      }

      throw new HttpsError("internal", "Internal Server Error");
    }
  }
);

