import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore } from "firebase-admin/firestore";
import { logSecurityEvent } from "../security/securityLog";
import { getInvokeId } from "../utils/invoke";

const REGION = "europe-west1";

/**
 * Cloud Function callable per l'eliminazione di un'istanza di checklist
 * esistente nel core Organizer.
 *
 * Riceve dal consumer `checklistId` e, se il documento
 * `checklists/{checklistId}` esiste, lo elimina insieme a tutti i suoi
 * dati (inclusi gli eventuali item). Una successiva lettura dello stesso
 * `checklistId` deve quindi risultare not-found.
 */
export const deleteChecklist = onCall(
  { region: REGION },
  async (request) => {
    const invokeId = getInvokeId(request);
    console.log(`[deleteChecklist] Invoke ID: ${invokeId} - Function called`);
    try {
      const uid = request.auth?.uid;
      if (!uid) {
        throw new HttpsError("unauthenticated", "User must be authenticated");
      }

      const { checklistId } = request.data as { checklistId?: string };

      if (!checklistId || typeof checklistId !== "string") {
        throw new HttpsError("invalid-argument", "Missing checklistId");
      }

      const db = getFirestore();
      const checklistRef = db.collection("checklists").doc(checklistId);
      const checklistSnap = await checklistRef.get();

      if (!checklistSnap.exists) {
        throw new HttpsError("not-found", "Checklist not found");
      }

      await checklistRef.delete();

      await logSecurityEvent({
        type: "system",
        action: "delete_checklist",
        outcome: "success",
        severity: "low",
        actor: { uid, email: request.auth?.token?.email ?? undefined },
        context: { function: "deleteChecklist", invokeId, requestId: checklistId },
      });

      console.log(`[deleteChecklist] OK: checklist ${checklistId} deleted by ${uid}`);
      return { success: true };
    } catch (error) {
      console.error("[deleteChecklist] KO:", error);
      await logSecurityEvent({
        type: "system",
        action: "delete_checklist_failed",
        outcome: "failure",
        severity: "high",
        actor: { uid: request.auth?.uid, email: request.auth?.token?.email ?? undefined },
        context: { function: "deleteChecklist", invokeId, requestId: request.data?.checklistId },
      });
      if (error instanceof HttpsError) throw error;
      throw new HttpsError("internal", "Internal Server Error");
    }
  }
);
