import {onCall} from "firebase-functions/v2/https";
import {getFirestore} from "firebase-admin/firestore";
import {
  REGION,
  asString,
  ensureAuthenticated,
  getActorContext,
} from "./helpers";

type ProjectDoc = {id: string} & Record<string, unknown>;

export const listProjects = onCall({region: REGION}, async (req) => {
  const uid = ensureAuthenticated(req.auth);
  const actor = await getActorContext(uid);

  const data = (req.data ?? {}) as Record<string, unknown>;
  const status = asString(data.status);
  const volunteerUid = asString(data.volunteerUid);
  const searchText = (asString(data.searchText) ?? "").toLowerCase();

  const db = getFirestore();
  const baseQuery = actor.role === "admin"
    ? db.collection("projects")
    : db.collection("projects").where("volunteerUids", "array-contains", uid);

  const snapshot = await baseQuery.get();
  const projectDocs: ProjectDoc[] = snapshot.docs.map((docSnap) => ({
    id: docSnap.id,
    ...(docSnap.data() as Record<string, unknown>),
  }));

  const projects = projectDocs
    .filter((project) => (status ? project.status === status : true))
    .filter((project) => {
      if (!volunteerUid) return true;
      const uids: string[] = Array.isArray(project.volunteerUids) ? project.volunteerUids : [];
      return uids.includes(volunteerUid);
    })
    .filter((project) => {
      if (!searchText) return true;
      const haystack = `${String(project.name ?? "")} ${String(project.description ?? "")}`.toLowerCase();
      return haystack.includes(searchText);
    });

  return {projects};
});
