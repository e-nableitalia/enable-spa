import {onCall, HttpsError} from "firebase-functions/v2/https";
import {FieldValue, getFirestore} from "firebase-admin/firestore";
import {logSecurityEvent} from "../security/securityLog";
import {getInvokeId} from "../utils/invoke";
import {sendTaskAssignedEmail} from "../utils/email";
import {sendTelegramMessage} from "../utils/telegram";
import {
  REGION,
  ensureAuthenticated,
  ensureLinkedEntity,
  ensureTaskPriority,
  ensureTaskStatus,
  ensureTaskOperator,
  ensureTaskType,
  getActorContext,
  normalizeAssignees,
  toTaskHistoryEntry,
  asString,
} from "./helpers";

export const createTask = onCall({
  region: REGION,
  secrets: ["TELEGRAM_API_URL", "TELEGRAM_API_SECRET"],
}, async (req) => {
  const invokeId = getInvokeId(req);
  const uid = ensureAuthenticated(req.auth);
  const actor = await getActorContext(uid);
  ensureTaskOperator(actor);

  const data = (req.data ?? {}) as Record<string, unknown>;
  const title = asString(data.title);
  if (!title) {
    throw new HttpsError("invalid-argument", "title is required");
  }

  const type = ensureTaskType(data.type ?? "generic");
  const status = ensureTaskStatus(data.status ?? "todo");
  const priority = ensureTaskPriority(data.priority ?? "medium");
  const linkedEntity = ensureLinkedEntity(type, data.linkedEntity);
  const description = asString(data.description);
  const notes = asString(data.notes);
  const notifyTelegramWaitingVolunteer = data.notifyTelegramWaitingVolunteer === true;
  const {assignees, assigneeUids} = normalizeAssignees(data.assignees);

  const history = [toTaskHistoryEntry("created", actor, {note: "Task created"})];

  const payload = {
    title,
    description: description ?? null,
    type,
    linkedEntity,
    status,
    priority,
    assignees,
    assigneeUids,
    notes: notes ?? null,
    createdByUid: actor.uid,
    createdByDisplayName: actor.displayName,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    completedAt: status === "done" ? FieldValue.serverTimestamp() : null,
    history,
    deleted: false,
  };

  try {
    const db = getFirestore();
    const taskRef = await db.collection("tasks").add(payload);

    if (status === "waiting_volunteer" && notifyTelegramWaitingVolunteer) {
      const apiUrl = process.env.TELEGRAM_API_URL;
      const secret = process.env.TELEGRAM_API_SECRET;
      if (apiUrl && secret) {
        const descriptionSnippet = (description ?? "").trim();
        const telegramMessage = descriptionSnippet
          ? `Nuovo task in attesa volontario\nTitolo: ${title}\nDescrizione: ${descriptionSnippet}`
          : `Nuovo task in attesa volontario\nTitolo: ${title}`;
        await sendTelegramMessage(apiUrl, secret, telegramMessage);
      } else {
        console.warn("Task Telegram notification requested but TELEGRAM_API_URL/TELEGRAM_API_SECRET not configured");
      }
    }

    if (assigneeUids.length > 0) {
      const assigneeDocs = await Promise.all(
        assigneeUids.map((assigneeUid) => db.collection("users").doc(assigneeUid).get())
      );

      const emailJobs = assigneeDocs
        .map((docSnap) => asString(docSnap.data()?.email))
        .filter((email): email is string => Boolean(email))
        .map((email) =>
          sendTaskAssignedEmail(email, {
            taskId: taskRef.id,
            title,
            priority,
            status,
            assignedBy: actor.displayName,
          })
        );

      await Promise.allSettled(emailJobs);
    }

    await logSecurityEvent({
      type: "system",
      action: "task_create",
      outcome: "success",
      severity: "medium",
      actor: {uid: actor.uid, email: actor.email ?? undefined},
      context: {
        function: "createTask",
        invokeId,
        metadata: {
          taskId: taskRef.id,
          title,
          assigneeCount: assigneeUids.length,
          role: actor.role,
          notifyTelegramWaitingVolunteer,
        },
      },
    });

    return {success: true, id: taskRef.id};
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    await logSecurityEvent({
      type: "system",
      action: "task_create",
      outcome: "failure",
      severity: "medium",
      actor: {uid: actor.uid, email: actor.email ?? undefined},
      context: {
        function: "createTask",
        invokeId,
        metadata: {
          title,
          assigneeCount: assigneeUids.length,
          role: actor.role,
          notifyTelegramWaitingVolunteer,
          error: errorMessage,
        },
      },
    });

    if (error instanceof HttpsError) {
      throw error;
    }
    throw new HttpsError("internal", "Unable to create task");
  }
});
