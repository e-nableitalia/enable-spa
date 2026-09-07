import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore } from "firebase-admin/firestore";
import { getInvokeId } from "../utils/invoke";
import { logSecurityEvent } from "../security/securityLog";
import { requireSuperAdmin } from "../security/superAdmin";
import { EMAIL_TEMPLATES, type EmailTemplateId } from "./registry";

const REGION = "europe-west1";

type LogOutcome = "success" | "blocked" | "failure";

/**
 * Cloud Function callable superadmin-gated (EA-171/172): applica il
 * registro versionato dei template email (`EMAIL_TEMPLATES`) alla
 * collection `emailTemplates` del progetto Firebase su cui la funzione è
 * deployata — forward-only (repo → Firestore, mai il contrario), nessuna
 * scelta esplicita di ambiente: ogni deploy della funzione opera solo sul
 * proprio progetto (staging o prod), come deciso in
 * `ir-email-templates-versioned`.
 */
export const deployEmailTemplates = onCall({ region: REGION }, async (request) => {
  const invokeId = getInvokeId(request);
  console.log(`[deployEmailTemplates] Invoke ID: ${invokeId} - Function called`);

  const uid = request.auth?.uid;
  const email = request.auth?.token?.email;

  async function logOutcome(outcome: LogOutcome, metadata: Record<string, unknown>): Promise<void> {
    await logSecurityEvent({
      type: "system",
      action: "deployEmailTemplates",
      outcome,
      severity: outcome === "success" ? "low" : outcome === "failure" ? "high" : "medium",
      actor: { uid, email: email ?? undefined },
      context: { function: "deployEmailTemplates", invokeId, metadata },
    });
  }

  if (!uid) {
    await logOutcome("blocked", { reason: "unauthenticated" });
    throw new HttpsError("unauthenticated", "Authentication required");
  }

  const db = getFirestore();

  try {
    await requireSuperAdmin(db, uid);
  } catch (error) {
    await logOutcome("blocked", { reason: "permission-denied" });
    throw error;
  }

  try {
    const batch = db.batch();
    const ids = Object.keys(EMAIL_TEMPLATES) as EmailTemplateId[];
    for (const id of ids) {
      batch.set(db.collection("emailTemplates").doc(id), EMAIL_TEMPLATES[id]);
    }
    await batch.commit();

    console.log(`[deployEmailTemplates] OK: ${ids.length} template(s) deployed by ${uid}`);
    await logOutcome("success", { templateIds: ids });

    return { templateIds: ids };
  } catch (error) {
    console.error("[deployEmailTemplates] KO:", error);
    await logOutcome("failure", { reason: "unexpected-error" });
    throw new HttpsError("internal", "Internal Server Error");
  }
});
