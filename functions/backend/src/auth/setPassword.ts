import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { logSecurityEvent } from "../security/securityLog";
import { getInvokeId } from "../utils/invoke";

const REGION = "europe-west1";

export const setPassword = onCall(
  { region: REGION },
  async (req) => {
    const invokeId = getInvokeId(req);
    console.log(`[setPassword] Invoke ID: ${invokeId} - Function called`);
    if (!req.auth?.uid) {
      throw new HttpsError("unauthenticated", "User must be authenticated");
    }

    const uid = req.auth.uid;
    const auth = getAuth();
    const db = getFirestore();

    try {
      const userRecord = await auth.getUser(uid);

      const hasPasswordProvider = userRecord.providerData.some(
        (p) => p.providerId === "password"
      );

      if (!hasPasswordProvider) {
        await logSecurityEvent({
          type: "auth",
          action: "set_password",
          outcome: "failure",
          severity: "medium",
          actor: {
            uid,
            email: userRecord.email ?? undefined,
          },
          context: {
            function: "setPassword",
            invokeId,
            metadata: {
              reason: "Password provider not linked",
            },
          },
        });
        throw new HttpsError(
          "failed-precondition",
          "Password provider not linked"
        );
      }

      await db.collection("users").doc(uid).update({
        mustSetPassword: false,
        passwordSetAt: Timestamp.now()
      });

      await logSecurityEvent({
        type: "auth",
        action: "set_password",
        outcome: "success",
        severity: "medium",
        actor: {
          uid,
          email: userRecord.email ?? undefined,
        },
        context: {
          function: "setPassword",
          invokeId,
        },
      });

      console.log(
        `[setPassword] OK: password set for user ${uid} (${userRecord.email})`
      );
      return { success: true };
    } catch (err) {
      await logSecurityEvent({
        type: "auth",
        action: "set_password_error",
        outcome: "failure",
        severity: "high",
        actor: {
          uid,
          email: req.auth?.token?.email ?? undefined,
        },
        context: {
          function: "setPassword",
          invokeId,
          metadata: {
            error: err instanceof Error ? err.message : String(err),
          },
        },
      });
      console.error(`[setPassword] KO:`, err);
      throw err;
    }
  }
);
