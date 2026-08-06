import {onCall, HttpsError} from "firebase-functions/v2/https";
import {getFirestore} from "firebase-admin/firestore";
import {logSecurityEvent} from "../security/securityLog";
import {getInvokeId} from "../utils/invoke";

// Limite Firestore: max 500 operazioni per commit di un batch.
const FIRESTORE_BATCH_WRITE_LIMIT = 500;

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

      const { checklistId } = request.data as { checklistId?: string };

      if (!checklistId || typeof checklistId !== "string") {
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

      // checklistItems e' una collection di primo livello (non una subcollection
      // di checklists): va interrogata e cancellata esplicitamente per non
      // lasciare item orfani, con chunking oltre il limite di 500 op/batch.
      const itemsSnap = await db
        .collection("checklistItems")
        .where("checklistId", "==", checklistId)
        .get();

      const docsToDelete = [ref, ...itemsSnap.docs.map((doc) => doc.ref)];
      for (let i = 0; i < docsToDelete.length; i += FIRESTORE_BATCH_WRITE_LIMIT) {
        const batch = db.batch();
        for (const docRef of docsToDelete.slice(i, i + FIRESTORE_BATCH_WRITE_LIMIT)) {
          batch.delete(docRef);
        }
        await batch.commit();
      }

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
