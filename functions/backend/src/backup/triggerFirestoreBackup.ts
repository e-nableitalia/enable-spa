import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore } from "firebase-admin/firestore";
import { v1 } from "@google-cloud/firestore";
import { getInvokeId } from "../utils/invoke";
import { logSecurityEvent } from "../security/securityLog";
import { requireSuperAdmin } from "../security/superAdmin";

const REGION = "europe-west1";

type LogOutcome = "success" | "blocked" | "failure";

/**
 * Cloud Function callable superadmin-gated (EA-171/172): avvia l'export
 * nativo Firestore verso il bucket GCS dedicato al backup, deciso dalla
 * spike IAM (EA-172) — `{projectId}-firestore-backups`, regione EU,
 * lifecycle di eliminazione automatica a 30 giorni. Nessuna scelta
 * esplicita di ambiente: ogni deploy della funzione esporta il proprio
 * progetto Firebase (staging o prod) nel proprio bucket dedicato.
 *
 * Richiede sul service account di runtime della funzione il ruolo
 * `roles/datastore.importExportAdmin` (progetto) e `roles/storage.objectAdmin`
 * scoped al bucket di backup — entrambi già concessi dalla spike IAM.
 */
export const triggerFirestoreBackup = onCall({ region: REGION, timeoutSeconds: 60 }, async (request) => {
  const invokeId = getInvokeId(request);
  console.log(`[triggerFirestoreBackup] Invoke ID: ${invokeId} - Function called`);

  const uid = request.auth?.uid;
  const email = request.auth?.token?.email;

  async function logOutcome(outcome: LogOutcome, metadata: Record<string, unknown>): Promise<void> {
    await logSecurityEvent({
      type: "system",
      action: "triggerFirestoreBackup",
      outcome,
      severity: outcome === "success" ? "low" : outcome === "failure" ? "high" : "medium",
      actor: { uid, email: email ?? undefined },
      context: { function: "triggerFirestoreBackup", invokeId, metadata },
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

  const projectId = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT;
  if (!projectId) {
    console.error("[triggerFirestoreBackup] KO: unable to resolve the current project id");
    await logOutcome("failure", { reason: "missing-project-id" });
    throw new HttpsError("internal", "Internal Server Error");
  }

  const bucket = `${projectId}-firestore-backups`;
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outputUriPrefix = `gs://${bucket}/${timestamp}`;

  try {
    const client = new v1.FirestoreAdminClient();
    const [operation] = await client.exportDocuments({
      name: client.databasePath(projectId, "(default)"),
      outputUriPrefix,
    });

    console.log(`[triggerFirestoreBackup] OK: export started by ${uid}, operation ${operation.name}`);
    await logOutcome("success", { outputUriPrefix, operationName: operation.name });

    return { outputUriPrefix, operationName: operation.name ?? null };
  } catch (error) {
    console.error("[triggerFirestoreBackup] KO:", error);
    await logOutcome("failure", { reason: "export-error" });
    throw new HttpsError("internal", "Internal Server Error");
  }
});
