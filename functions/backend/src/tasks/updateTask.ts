import {onCall, HttpsError} from "firebase-functions/v2/https";
import {FieldValue, getFirestore} from "firebase-admin/firestore";
import {logSecurityEvent} from "../security/securityLog";
import {getInvokeId} from "../utils/invoke";
import {sendTaskAssignedEmail} from "../utils/email";
import {
  REGION,
  asArray,
  asString,
  ensureAuthenticated,
  ensureLinkedEntity,
  ensureTaskPriority,
  ensureTaskOperator,
  ensureTaskType,
  getActorContext,
  isAssignedTo,
  normalizeAssignees,
  toTaskHistoryEntry,
} from "./helpers";

export const updateTask = onCall({region: REGION}, async (req) => {
  const invokeId = getInvokeId(req);
  const uid = ensureAuthenticated(req.auth);
  const actor = await getActorContext(uid);
  ensureTaskOperator(actor);

  const data = (req.data ?? {}) as Record<string, unknown>;
  const taskId = asString(data.taskId);
  if (!taskId) {
    throw new HttpsError("invalid-argument", "taskId is required");
  }

  try {
    const db = getFirestore();
    const taskRef = db.collection("tasks").doc(taskId);
    const taskSnap = await taskRef.get();
    if (!taskSnap.exists) {
      throw new HttpsError("not-found", "Task not found");
    }

    const current = taskSnap.data() ?? {};
    const currentAssigneeUids = asArray<string>(current.assigneeUids);
    const currentPriority = asString(current.priority) ?? "medium";
    const currentLinkedEntity = current.linkedEntity as Record<string, unknown> | undefined;
    const canManageAll = actor.role === "admin";
    const isCreator = asString(current.createdByUid) === actor.uid;
    const isAssigned = isAssignedTo(actor.uid, currentAssigneeUids);
    const isUnassigned = currentAssigneeUids.length === 0;

    if (!canManageAll && !isCreator && !isAssigned && !isUnassigned) {
      throw new HttpsError("permission-denied", "You can only update your tasks or unassigned tasks");
    }

    const nextType = ensureTaskType(data.type ?? current.type ?? "generic");
    const nextLinkedEntity = ensureLinkedEntity(nextType, data.linkedEntity ?? current.linkedEntity);
    const nextPriority = ensureTaskPriority(data.priority ?? current.priority ?? "medium");

    const {assignees, assigneeUids} = normalizeAssignees(data.assignees ?? current.assignees ?? []);

    const updatePayload: Record<string, unknown> = {
      title: asString(data.title) ?? asString(current.title) ?? "",
      description: asString(data.description) ?? asString(current.description) ?? null,
      type: nextType,
      linkedEntity: nextLinkedEntity,
      priority: nextPriority,
      assignees,
      assigneeUids,
      notes: asString(data.notes) ?? asString(current.notes) ?? null,
      updatedAt: FieldValue.serverTimestamp(),
    };

    const history = asArray<ReturnType<typeof toTaskHistoryEntry>>(current.history);

    if (currentPriority !== nextPriority) {
      history.push(
        toTaskHistoryEntry("priority_changed", actor, {
          fromPriority: currentPriority as "low" | "medium" | "high" | "urgent",
          toPriority: nextPriority,
        })
      );
    }

    const prevLinkedKey = JSON.stringify(currentLinkedEntity ?? {});
    const nextLinkedKey = JSON.stringify(nextLinkedEntity ?? {});
    if (prevLinkedKey !== nextLinkedKey) {
      history.push(toTaskHistoryEntry("linked_entity_changed", actor));
    }

    const currentSet = new Set(currentAssigneeUids);
    const nextSet = new Set(assigneeUids);
    const assigned = assigneeUids.filter((id) => !currentSet.has(id));
    const unassigned = currentAssigneeUids.filter((id) => !nextSet.has(id));

    if (assigned.length > 0) {
      history.push(toTaskHistoryEntry("assigned", actor, {note: assigned.join(", ")}));
    }
    if (unassigned.length > 0) {
      history.push(toTaskHistoryEntry("unassigned", actor, {note: unassigned.join(", ")}));
    }

    history.push(toTaskHistoryEntry("updated", actor));
    updatePayload.history = history;

    await taskRef.update(updatePayload);

    if (assigned.length > 0) {
      const assignedSet = new Set(assigned);
      const newlyAssignedVolunteerUids = assignees
        .filter((item) => item.type === "volunteer" && typeof item.volunteerUid === "string")
        .map((item) => item.volunteerUid as string)
        .filter((volunteerUid) => assignedSet.has(volunteerUid));

      if (newlyAssignedVolunteerUids.length > 0) {
        const assigneeDocs = await Promise.all(
          newlyAssignedVolunteerUids.map((assigneeUid) => db.collection("users").doc(assigneeUid).get())
        );

        const emailJobs = assigneeDocs
          .map((docSnap) => asString(docSnap.data()?.email))
          .filter((email): email is string => Boolean(email))
          .map((email) =>
            sendTaskAssignedEmail(email, {
              taskId,
              title: String(updatePayload.title ?? current.title ?? "Task"),
              priority: String(nextPriority),
              status: String(current.status ?? "todo"),
              assignedBy: actor.displayName,
            })
          );

        await Promise.allSettled(emailJobs);
      }
    }

    await logSecurityEvent({
      type: "system",
      action: "task_update",
      outcome: "success",
      severity: "medium",
      actor: {uid: actor.uid, email: actor.email ?? undefined},
      context: {
        function: "updateTask",
        invokeId,
        metadata: {
          taskId,
          role: actor.role,
          assigneeCount: assigneeUids.length,
          assignedAdded: assigned,
          unassignedRemoved: unassigned,
        },
      },
    });

    return {success: true};
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    await logSecurityEvent({
      type: "system",
      action: "task_update",
      outcome: "failure",
      severity: "medium",
      actor: {uid: actor.uid, email: actor.email ?? undefined},
      context: {
        function: "updateTask",
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
    throw new HttpsError("internal", "Unable to update task");
  }
});
