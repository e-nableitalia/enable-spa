import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { verifyRecaptcha } from "../security/recaptcha";
import { checkEmailRateLimit, checkIpRateLimit } from "../security/rateLimit";
import { logSecurityEvent } from "../security/securityLog";
import { sendEmailToVolunteersAdmins, sendRegistrationEmail } from "../utils/email";
import { getInvokeId } from "../utils/invoke";

// Utility: Estrae oobCode dal link generato (gestisce link annidati e url encoded)
function extractOobCode(link: string): string | null {
  try {
    const url = new URL(link);
    // Caso: link contiene parametro "link" che è una URL annidata
    const innerLink = url.searchParams.get("link");
    if (innerLink) {
      const innerUrl = new URL(decodeURIComponent(innerLink));
      const oobCode = innerUrl.searchParams.get("oobCode");
      return oobCode;
    }
    // Caso: link diretto
    const oobCode = url.searchParams.get("oobCode");
    return oobCode;
  } catch (err) {
    console.error("[extractOobCode] KO:", err, link);
    return null;
  }
}

const auth = getAuth();
const db = getFirestore();

const REGION = "europe-west1";

// Cloud Function: register
export const register = onCall(
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
  async (req) => {
    const invokeId = getInvokeId(req);
    console.log(`[register] Invoke ID: ${invokeId} - Function called`);
    try {
      const { email, recaptchaToken } = req.data;

      if (!email || !recaptchaToken) {
        throw new HttpsError("invalid-argument", "Missing data");
      }

      const ip = req.rawRequest.ip ?? "unknown";
      const apiKey = process.env.RECAPTCHA_API_KEY;
      const siteKey = process.env.RECAPTCHA_SITE_KEY;

      if (!apiKey) throw new HttpsError("internal", "RECAPTCHA_API_KEY is not set");
      if (!siteKey) throw new HttpsError("internal", "RECAPTCHA_SITE_KEY is not set");

      // check reCAPTCHA
      const { score, reasons } = await verifyRecaptcha(
        recaptchaToken,
        "register_email",
        siteKey,
        apiKey
      );
      await logSecurityEvent({
        type: "security",
        action: "register_recaptcha_check",
        outcome: score < 0.6 ? "blocked" : "success",
        severity: score < 0.6 ? "high" : "low",
        actor: {
          email,
          ip,
        },
        context: {
          function: "register",
          invokeId,
          metadata: {
            score,
            reasons,
          },
        },
      });
      if (score < 0.6) throw new HttpsError("permission-denied", "Spam detected");

      console.log(`[register] reCAPTCHA passed with score ${score} for email ${email} (reasons: ${reasons.join(", ")})`);
      console.log(`[register] Checking rate limits for email ${email} and IP ${ip}`);
      // check Rate limiting
      await checkEmailRateLimit(email);
      await checkIpRateLimit(ip);

      console.log("Generating sign-in link for email:", email);
      // Generate link
      const actionCodeSettings = {
        url: "https://app.e-nableitalia.it/complete-registration",
        handleCodeInApp: true,
        iOS: { bundleId: 'app.e-nableitalia.it' },
        android: {
          packageName: 'app.e-nableitalia.it',
          installApp: true,
          minimumVersion: '12'
        },
        linkDomain: 'app.e-nableitalia.it'
      };

      const link = await auth.generateSignInWithEmailLink(email, actionCodeSettings);

      // Extract oobCode from link
      console.log(`Extracting oobCode from link: ${link}`);
      const oobCode = extractOobCode(link);
      if (!oobCode) throw new HttpsError("internal", "Unable to extract oobCode");

      console.log(`oobCode extracted: ${oobCode} for email ${email}, saving pending registration and sending email`);
      // Save pending registration in Firestore
      const pendingDoc = {
        email,
        oobCode,
        createdAt: Timestamp.now(),
        validated: false,
        validatedAt: null
      };
      await db.collection("pendingRegistrations").doc(oobCode).set(pendingDoc);

      // Send email
      await sendRegistrationEmail(email, link);

      await logSecurityEvent({
        type: "auth",
        action: "register",
        outcome: "success",
        severity: "medium",
        actor: {
          email,
          ip,
        },
        context: {
          function: "register",
          invokeId,
          requestId: oobCode,
        },
      });

      await sendEmailToVolunteersAdmins(
        "Nuova registrazione",
        `È stata effettuata una nuova registrazione per l'email: ${email}`
      );

      console.log(`[register] OK: pending registration for ${email} (${oobCode}) saved and email sent`);
      return { success: true };
    } catch (err) {
      console.error(`[register] KO:`, err);
      await logSecurityEvent({
        type: "auth",
        action: "register",
        outcome: "failure",
        severity: "high",
        actor: {
          email: req?.auth?.token?.email ?? "unknown",
          ip: req?.rawRequest?.ip ?? "unknown",
        },
        context: {
          function: "register",
          invokeId,
          requestId: req?.data?.oobCode,
        },
      });
      throw err;
    }
  }
);

// Cloud Function: checkRegistration
// Verifica se oobCode è valido e non scaduto, e restituisce email associata
export const checkRegistration = onCall(
  {
    region: REGION,
    secrets: []
  },
  async (req) => {
    const invokeId = getInvokeId(req);
    try {
      const { oobCode } = req.data;
      if (!oobCode) throw new HttpsError("invalid-argument", "Missing oobCode");

      const docRef = db.collection("pendingRegistrations").doc(oobCode);
      const docSnap = await docRef.get();
      if (!docSnap.exists) throw new HttpsError("not-found", "Registration not found");

      const pending = docSnap.data() as {
        email: string,
        oobCode: string,
        createdAt: Timestamp,
        validated: boolean,
        validatedAt: Timestamp | null
      };

      if (pending.validated) {
        throw new HttpsError("failed-precondition", "Registration already validated");
      }

      const now = Timestamp.now();
      const expiresAt = new Timestamp(pending.createdAt.seconds + 24 * 3600, pending.createdAt.nanoseconds);
      if (now.toMillis() > expiresAt.toMillis()) {
        throw new HttpsError("deadline-exceeded", "Registration expired");
      }

      await docRef.update({
        validated: true,
        validatedAt: now
      });

      await logSecurityEvent({
        type: "auth",
        action: "check_registration",
        outcome: "success",
        severity: "medium",
        actor: {
          email: pending.email,
        },
        context: {
          function: "checkRegistration",
          invokeId,
          requestId: oobCode,
        },
      });

      console.log(`[checkRegistration] OK: oobCode ${oobCode} validated for ${pending.email}`);
      return { success: true, email: pending.email };
    } catch (err) {
      console.error(`[checkRegistration] KO:`, err);
      await logSecurityEvent({
        type: "auth",
        action: "check_registration",
        outcome: "failure",
        severity: "high",
        actor: {
          email: req.auth?.token.email ?? "unknown",
        },
        context: {
          function: "checkRegistration",
          invokeId,
          requestId: req.data.oobCode,
        },
      });
      throw err;
    }
  }
);
// Cloud Function: completeRegistration
// Completa la registrazione: crea utente Firebase e ruolo in Firestore
export const completeRegistration = onCall(
  {
    region: REGION,
    secrets: []
  },
  async (req) => {
    const invokeId = getInvokeId(req);
    try {
      const auth = getAuth();
      const db = getFirestore();
      const uid = req.auth?.uid;
      if (!uid) throw new HttpsError("unauthenticated", "User must be authenticated");

      const user = await auth.getUser(uid);
      const email = user.email;
      if (!email) throw new HttpsError("internal", "User has no email");

      // users are created with active=false, so we need to enable them here
      await db.collection("users").doc(uid).set({
        email,
        role: "volunteer",
        active: false,
        mustSetPassword: true,
        createdAt: Timestamp.now(),
        provider: req?.auth?.token.firebase?.sign_in_provider,
      });

      await logSecurityEvent({
        type: "auth",
        action: "complete_registration",
        outcome: "success",
        severity: "medium",
        actor: {
          uid,
          email,
          provider: req?.auth?.token.firebase?.sign_in_provider,
        },
        context: {
          function: "completeRegistration",
          invokeId,
        },
      });

      await sendEmailToVolunteersAdmins(
        "Nuova registrazione completata",
        `<p>La registrazione per l'email <b>${email}</b> è stata completata con successo.</p>`
      );

      console.log(`[completeRegistration] OK: user ${uid} (${email}) created`);
      return { success: true };
    } catch (err) {
      console.error(`[completeRegistration] KO:`, err);
      await logSecurityEvent({
        type: "auth",
        action: "complete_registration",
        outcome: "failure",
        severity: "high",
        actor: {
          uid: req.auth?.uid ?? "unknown",
          email: req.auth?.token.email ?? "unknown",
          provider: req?.auth?.token.firebase?.sign_in_provider ?? "unknown",
        },
        context: {
          function: "completeRegistration",
          invokeId,
        },
      });
      throw err;
    }
  }
);

export const registerWithIntegratedAuth = onCall(
  { region: REGION },
  async (req) => {
    try {
      const invokeId = getInvokeId(req);
      console.log(`[registerWithIntegratedAuth] Invoke ID: ${invokeId} - Function called`);
      if (!req.auth?.uid) {
        throw new HttpsError("unauthenticated", "User must be authenticated");
      }

      const uid = req.auth.uid;
      const email = req.auth.token.email;

      if (!email) {
        throw new HttpsError("internal", "Authenticated user has no email");
      }

      const db = getFirestore();
      const userRef = db.collection("users").doc(uid);
      const snap = await userRef.get();

      // Se utente già esiste → non fare nulla
      if (snap.exists) {
        await logSecurityEvent({
          type: "auth",
          action: "login",
          outcome: "success",
          severity: "low",
          actor: {
            uid,
            email,
            provider: req?.auth?.token.firebase?.sign_in_provider ?? "unknown"
          },
          context: {
            function: "registerWithIntegratedAuth",
            invokeId,
            requestId: userRef.id,
          },
        });
        return { alreadyExists: true };
      }

      // Eventuale controllo dominio (esempio)
      // if (!email.endsWith("@enableitalia.it")) {
      //   throw new HttpsError("permission-denied", "Invalid email domain");
      // }

      // Invia una mail a volontari@e-nableitalia.it per notificare la registrazione del nuovo utente
      await sendEmailToVolunteersAdmins(
        "Nuova registrazione",
        `<p>Nuova registrazione: <b>${email}</b> (uid: <code>${uid}</code>)</p>`
      );

      await userRef.set({
        email,
        role: "volunteer",
        active: false,
        mustSetPassword: false,
        createdAt: Timestamp.now(),
        authProvider: req.auth.token.firebase?.sign_in_provider ?? "unknown"
      });

      await logSecurityEvent({
        type: "security",
        action: "register_integrated_auth",
        outcome: "success",
        severity: "low",
        actor: {
          uid: req.auth.uid,
          email,
          provider: req?.auth?.token?.firebase?.sign_in_provider ?? "unknown"
        },
        context: {
          function: "registerWithIntegratedAuth",
          requestId: userRef.id,
        }
      });

      return { success: true };
    } catch (err) {
      console.error(`[registerWithIntegratedAuth] KO:`, err);
      await logSecurityEvent({
        type: "auth",
        action: "register_integrated_auth",
        outcome: "failure",
        severity: "high",
        actor: {
          uid: req.auth?.uid ?? "unknown",
          email: req.auth?.token?.email ?? "unknown",
          provider: req?.auth?.token.firebase?.sign_in_provider ?? "unknown"
        },
        context: {
          function: "registerWithIntegratedAuth",
          invokeId: getInvokeId(req),
          requestId: req.auth?.uid ?? "unknown"
        }
      });
      throw err;
    }
  }
);

export const doLogin = onCall(
  { region: REGION },
  async (req) => {
    try {
      const invokeId = getInvokeId(req);
      console.log(`[doLogin] Invoke ID: ${invokeId} - Function called`);
      if (!req.auth?.uid) {
        throw new HttpsError("unauthenticated", "User must be authenticated");
      }
      const uid = req.auth?.uid ?? "unknown";
      const email = req.auth?.token?.email ?? "unknown";
      const provider = req.auth?.token?.firebase?.sign_in_provider ?? "unknown";
      const ip = req.rawRequest?.ip ?? "unknown";

      await logSecurityEvent({
        type: "auth",
        action: "login",
        outcome: "success",
        severity: "low",
        actor: {
          uid,
          email,
          provider,
          ip,
        },
        context: {
          function: "logLoginEvent",
          invokeId,
        },
      });

      return { logged: true };
    } catch (err) {
      console.error(`[doLogin] KO:`, err);
      await logSecurityEvent({
        type: "auth",
        action: "login",
        outcome: "failure",
        severity: "high",
        actor: {
          uid: req.auth?.uid ?? "unknown",
          email: req.auth?.token?.email ?? "unknown",
          provider: req.auth?.token?.firebase?.sign_in_provider ?? "unknown",
          ip: req.rawRequest?.ip ?? "unknown",
        },
        context: {
          function: "logLoginEvent",
          invokeId: getInvokeId(req),
        },
      });
      throw err;
    }
  }
);
