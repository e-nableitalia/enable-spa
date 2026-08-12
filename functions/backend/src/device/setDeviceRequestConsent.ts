import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { getInvokeId } from "../utils/invoke";
import { logSecurityEvent } from "../security/securityLog";

const REGION = "europe-west1";

type ConsentType = "waiver" | "photoRelease";

const CONSENT_TYPES: ConsentType[] = ["waiver", "photoRelease"];

const SECURITY_ACTION: Record<ConsentType, string> = {
  waiver: "set_waiver_acquired",
  photoRelease: "set_photo_release_acquired",
};

/**
 * Cloud Function callable per l'acquisizione, da parte del solo admin, delle
 * liberatorie familiari collegate a una deviceRequest (EA-158): scarico di
 * responsabilità (`consentType: "waiver"`) e liberatoria foto
 * (`consentType: "photoRelease"`).
 *
 * RBAC: a differenza di altre azioni sulla deviceRequest (es. checklist,
 * cambio stato), il volontario assegnato NON è mai autorizzato — solo admin.
 *
 * Scrive sul documento `deviceRequests/{requestId}`:
 * - `{consentType}Acquired`: true
 * - `{consentType}AcquiredDate`: serverTimestamp
 * - `{consentType}AcquiredBy`: uid dell'admin
 *
 * Registra inoltre un evento di security (stesso pattern di
 * `createDeviceRequest.ts`, `saveGlobalMessage.ts`,
 * `utils/volunteerAssignment.ts`).
 */
export const setDeviceRequestConsent = onCall(
  { region: REGION },
  async (request) => {
    const invokeId = getInvokeId(request);
    console.log(`[setDeviceRequestConsent] Invoke ID: ${invokeId} - Function called`);

    const authUid = request.auth?.uid;
    if (!authUid) {
      console.log("[setDeviceRequestConsent] KO: Unauthenticated");
      throw new HttpsError("unauthenticated", "User must be authenticated");
    }

    const { requestId, consentType } = (request.data ?? {}) as {
      requestId?: string;
      consentType?: ConsentType;
    };

    if (!requestId || typeof requestId !== "string" || !consentType || !CONSENT_TYPES.includes(consentType)) {
      console.log("[setDeviceRequestConsent] KO: Missing or invalid parameters");
      throw new HttpsError("invalid-argument", "Missing or invalid parameters");
    }

    const db = getFirestore();

    const userSnap = await db.collection("users").doc(authUid).get();
    if (!userSnap.exists || userSnap.data()?.role !== "admin") {
      console.log(`[setDeviceRequestConsent] KO: Permission denied for uid ${authUid}`);
      throw new HttpsError("permission-denied", "Only admin can acquire family waivers");
    }

    const requestRef = db.collection("deviceRequests").doc(requestId);
    const requestSnap = await requestRef.get();
    if (!requestSnap.exists) {
      console.log(`[setDeviceRequestConsent] KO: request ${requestId} not found`);
      throw new HttpsError("not-found", "Device request not found");
    }

    const acquiredField = `${consentType}Acquired`;
    const dateField = `${consentType}AcquiredDate`;
    const byField = `${consentType}AcquiredBy`;

    try {
      await requestRef.update({
        [acquiredField]: true,
        [dateField]: FieldValue.serverTimestamp(),
        [byField]: authUid,
        updatedAt: FieldValue.serverTimestamp(),
      });

      await logSecurityEvent({
        type: "system",
        action: SECURITY_ACTION[consentType],
        outcome: "success",
        severity: "medium",
        actor: { uid: authUid },
        context: {
          function: "setDeviceRequestConsent",
          invokeId,
          requestId,
          metadata: { consentType },
        },
      });

      console.log(`[setDeviceRequestConsent] OK: ${acquiredField} set for request ${requestId}`);
      return { success: true };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`[setDeviceRequestConsent] KO: ${errorMsg}`);

      await logSecurityEvent({
        type: "system",
        action: SECURITY_ACTION[consentType],
        outcome: "failure",
        severity: "high",
        actor: { uid: authUid },
        context: {
          function: "setDeviceRequestConsent",
          invokeId,
          requestId,
          metadata: { consentType, error: errorMsg },
        },
      });

      throw error instanceof HttpsError
        ? error
        : new HttpsError("internal", "Errore durante l'acquisizione della liberatoria");
    }
  }
);
