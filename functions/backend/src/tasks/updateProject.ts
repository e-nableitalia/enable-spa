import {onCall, HttpsError} from "firebase-functions/v2/https";
import {FieldValue, getFirestore} from "firebase-admin/firestore";
import {
  REGION,
  asArray,
  asString,
  ensureAdmin,
  ensureAuthenticated,
  getActorContext,
} from "./helpers";

const PROJECT_STATUSES = ["draft", "active", "paused", "completed", "archived"];

export const updateProject = onCall({region: REGION}, async (req) => {
  const uid = ensureAuthenticated(req.auth);
  const actor = await getActorContext(uid);
  ensureAdmin(actor);

  const data = (req.data ?? {}) as Record<string, unknown>;
  const projectId = asString(data.projectId);
  if (!projectId) {
    throw new HttpsError("invalid-argument", "projectId is required");
  }

  const db = getFirestore();
  const projectRef = db.collection("projects").doc(projectId);
  const snap = await projectRef.get();
  if (!snap.exists) {
    throw new HttpsError("not-found", "Project not found");
  }

  const current = snap.data() ?? {};

  const status = asString(data.status) ?? asString(current.status) ?? "draft";
  if (!PROJECT_STATUSES.includes(status)) {
    throw new HttpsError("invalid-argument", "Invalid project status");
  }

  const referenceLinks = asArray<Record<string, unknown>>(data.referenceLinks ?? current.referenceLinks)
    .map((item) => ({label: asString(item.label) ?? "", url: asString(item.url) ?? ""}))
    .filter((item) => item.label.length > 0 && item.url.length > 0);

  const volunteers = asArray<Record<string, unknown>>(data.volunteers ?? current.volunteers)
    .map((item) => ({
      uid: asString(item.uid) ?? "",
      displayName: asString(item.displayName),
      role: asString(item.role),
    }))
    .filter((item) => item.uid.length > 0);

  const volunteerUids = Array.from(new Set(volunteers.map((item) => item.uid)));

  await projectRef.update({
    name: asString(data.name) ?? asString(current.name) ?? "",
    description: asString(data.description) ?? asString(current.description) ?? null,
    status,
    referenceLinks,
    volunteers,
    volunteerUids,
    notes: asString(data.notes) ?? asString(current.notes) ?? null,
    updatedAt: FieldValue.serverTimestamp(),
  });

  return {success: true};
});
