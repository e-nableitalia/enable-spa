import {onCall} from "firebase-functions/v2/https";
import {getFirestore} from "firebase-admin/firestore";
import {
  REGION,
  asString,
  ensureAuthenticated,
  getActorContext,
  timestampFromInput,
} from "./helpers";

type TaskDoc = {id: string} & Record<string, unknown>;

export const listTasks = onCall({region: REGION}, async (req) => {
  const uid = ensureAuthenticated(req.auth);
  const actor = await getActorContext(uid);

  const data = (req.data ?? {}) as Record<string, unknown>;
  const status = asString(data.status);
  const priority = asString(data.priority);
  const type = asString(data.type);
  const deviceRequestId = asString(data.deviceRequestId);
  const projectId = asString(data.projectId);
  const assigneeUid = asString(data.assigneeUid);
  const view = asString(data.view);
  const createdFrom = timestampFromInput(data.createdFrom);
  const createdTo = timestampFromInput(data.createdTo);

  const db = getFirestore();
  const baseQuery = db.collection("tasks");

  const snapshot = await baseQuery.get();

  const taskDocs: TaskDoc[] = snapshot.docs.map((docSnap) => ({
    id: docSnap.id,
    ...(docSnap.data() as Record<string, unknown>),
  }));

  const tasks = taskDocs
    .filter((task) => {
      if (actor.role === "admin") {
        return true;
      }

      const uids: string[] = Array.isArray(task.assigneeUids) ? task.assigneeUids : [];
      if (view === "unassigned") {
        return uids.length === 0;
      }

      return uids.includes(uid);
    })
    .filter((task) => task.deleted !== true)
    .filter((task) => (status ? task.status === status : true))
    .filter((task) => (priority ? task.priority === priority : true))
    .filter((task) => (type ? task.type === type : true))
    .filter((task) => {
      if (!deviceRequestId) return true;
      const linked = (task.linkedEntity ?? {}) as Record<string, unknown>;
      return linked.deviceRequestId === deviceRequestId;
    })
    .filter((task) => {
      if (!projectId) return true;
      const linked = (task.linkedEntity ?? {}) as Record<string, unknown>;
      return linked.projectId === projectId;
    })
    .filter((task) => {
      if (!assigneeUid) return true;
      const uids: string[] = Array.isArray(task.assigneeUids) ? task.assigneeUids : [];
      return uids.includes(assigneeUid);
    })
    .filter((task) => {
      const createdAt = timestampFromInput(task.createdAt);
      if (!createdAt) return !createdFrom && !createdTo;
      if (createdFrom && createdAt < createdFrom) return false;
      if (createdTo && createdAt > createdTo) return false;
      return true;
    });

  return {tasks};
});
