import {onCall, HttpsError} from "firebase-functions/v2/https";
import {FieldValue, getFirestore} from "firebase-admin/firestore";
import {logSecurityEvent} from "../security/securityLog";
import {getInvokeId} from "../utils/invoke";
import {
  REGION,
  asString,
  ensureAuthenticated,
  ensureTaskOperator,
  getActorContext,
} from "./helpers";

export const deleteTask = onCall({region: REGION}, async (req) => {
  const invokeId = getInvokeId(req);
  const uid = ensureAuthenticated(req.auth);
  const actor = await getActorContext(uid);
  ensureTaskOperator(actor);

  const taskId = asString((req.data as {taskId?: unknown} | undefined)?.taskId);
  if (!taskId) {
    throw new HttpsError("invalid-argument", "taskId is required");
  }

  try {
    const db = getFirestore();
    const taskRef = db.collection("tasks").doc(taskId);
    const snap = await taskRef.get();
    if (!snap.exists) {
      throw new HttpsError("not-found", "Task not found");
    }

    const task = snap.data() ?? {};
    const createdByUid = asString(task.createdByUid);
    if (actor.role !== "admin" && createdByUid !== actor.uid) {
      throw new HttpsError("permission-denied", "You can only delete tasks created by you");
    }

    await taskRef.update({
      deleted: true,
      deletedAt: FieldValue.serverTimestamp(),
      deletedByUid: actor.uid,
      updatedAt: FieldValue.serverTimestamp(),
    });

    await logSecurityEvent({
      type: "system",
      action: "task_delete",
      outcome: "success",
      severity: "medium",
      actor: {uid: actor.uid, email: actor.email ?? undefined},
      context: {
        function: "deleteTask",
        invokeId,
        metadata: {
          taskId,
          role: actor.role,
        },
      },
    });

    return {success: true};
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    await logSecurityEvent({
      type: "system",
      action: "task_delete",
      outcome: "failure",
      severity: "medium",
      actor: {uid: actor.uid, email: actor.email ?? undefined},
      context: {
        function: "deleteTask",
        invokeId,
        metadata: {
          taskId,
          role: actor.role,
          error: errorMessage,
        },
      },
    });

    if (error instanceof HttpsError) {
      throw error;
    }
    throw new HttpsError("internal", "Unable to delete task");
  }
});
