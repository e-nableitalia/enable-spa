import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore } from "firebase-admin/firestore";
import { logSecurityEvent } from "../security/securityLog";
import { getInvokeId } from "../utils/invoke";

const REGION = "europe-west1";

/**
 * Cloud Function callable per l'eliminazione di un template di checklist
 * esistente nel core Organizer.
 *
 * Riceve dal consumer:
 * - `templateId`: identificatore del template da eliminare.
 *
 * Elimina il documento `templates/{templateId}`. Le istanze checklist che
 * referenziano questo template tramite `fromTemplate` non vengono toccate:
 * il riferimento resta un dato storico e non viene ricalcolato né rimosso.
 */
export const deleteTemplate = onCall(
  { region: REGION },
  async (request) => {
    const invokeId = getInvokeId(request);
    console.log(`[deleteTemplate] Invoke ID: ${invokeId} - Function called`);
    try {
      if (!request.auth) {
        console.log("[deleteTemplate] KO: Unauthenticated");
        throw new HttpsError("unauthenticated", "Authentication required");
      }

      const data = request.data ?? {};
      const { templateId } = data;

      if (!templateId || typeof templateId !== "string") {
        console.log("[deleteTemplate] KO: Missing or invalid templateId");
        throw new HttpsError("invalid-argument", "Missing or invalid templateId");
      }

      const db = getFirestore();
      const templateRef = db.collection("templates").doc(templateId);
      const templateSnap = await templateRef.get();

      if (!templateSnap.exists) {
        console.log(`[deleteTemplate] KO: template ${templateId} not found`);
        throw new HttpsError("not-found", "Template not found");
      }

      await templateRef.delete();

      await logSecurityEvent({
        type: "system",
        action: "delete_template",
        outcome: "success",
        severity: "low",
        actor: { uid: request.auth.uid, email: request.auth.token?.email ?? undefined },
        context: { function: "deleteTemplate", invokeId, requestId: templateId },
      });

      console.log(`[deleteTemplate] OK: template ${templateId} deleted`);
      return { templateId };
    } catch (error) {
      console.error("[deleteTemplate] KO:", error);
      await logSecurityEvent({
        type: "system",
        action: "delete_template_failed",
        outcome: "failure",
        severity: "high",
        actor: { uid: request.auth?.uid, email: request.auth?.token?.email ?? undefined },
        context: { function: "deleteTemplate", invokeId, requestId: request.data?.templateId },
      });

      if (error instanceof HttpsError) {
        throw error;
      }

      throw new HttpsError("internal", "Internal Server Error");
    }
  }
);
