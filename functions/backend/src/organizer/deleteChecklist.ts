import {onCall, HttpsError} from "firebase-functions/v2/https";
import {getFirestore} from "firebase-admin/firestore";
import {logSecurityEvent} from "../security/securityLog";
import {getInvokeId} from "../utils/invoke";

export const deleteChecklist = onCall(
  {region: "europe-west1"},
  async (request) => {
    const invokeId = getInvokeId(request);
    console.log(`[deleteChecklist] Invoke ID: ${invokeId} - Function called`);
    try {
      const uid = request.auth?.uid;
      if (!uid) {
        throw new HttpsError("unauthenticated", "User must be authenticated");
      }

      const {checklistId} = request.data as {checklistId?: string};
      if (!checklistId) {
        throw new HttpsError("invalid-argument", "Missing checklistId");
      }

      const db = getFirestore();

      const userSnap = await db.collection("users").doc(uid).get();
      if (!userSnap.exists) {
        throw new HttpsError("permission-denied", "User not found");
      }
      const role = userSnap.data()?.role;

      const ref = db.collection("checklists").doc(checklistId);
      const snap = await ref.get();
      if (!snap.exists) {
        throw new HttpsError("not-found", "Checklist not found");
      }

      const data = snap.data()!;

      if (role !== "admin" && data.createdBy !== uid) {
        console.log(`[deleteChecklist] KO: uid ${uid} tried to delete checklist ${checklistId} owned by another user`);
        throw new HttpsError("permission-denied", "Cannot delete another user's checklist");
      }

      // Elimina il documento e tutte le sue subcollection (es. items)
      await db.recursiveDelete(ref);

      await logSecurityEvent({
        type: "system",
        action: "delete_checklist",
        outcome: "success",
        severity: "low",
        actor: {uid, email: request.auth?.token?.email ?? undefined},
        context: {function: "deleteChecklist", invokeId, requestId: checklistId},
      });

      console.log(`[deleteChecklist] OK: checklist ${checklistId} deleted by ${uid}`);
      return {success: true};
    } catch (error) {
      console.error("[deleteChecklist] KO:", error);
      await logSecurityEvent({
        type: "system",
        action: "delete_checklist_failed",
        outcome: "failure",
        severity: "high",
        actor: {uid: request.auth?.uid, email: request.auth?.token?.email ?? undefined},
        context: {function: "deleteChecklist", invokeId, requestId: request.data?.checklistId},
      });
      if (error instanceof HttpsError) throw error;
      throw new HttpsError("internal", "Internal Server Error");
    }
  }
);
