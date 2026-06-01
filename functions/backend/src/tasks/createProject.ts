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

const PROJECT_STATUSES = new Set(["draft", "active", "paused", "completed", "archived"]);

export const createProject = onCall({region: REGION}, async (req) => {
  const uid = ensureAuthenticated(req.auth);
  const actor = await getActorContext(uid);
  ensureAdmin(actor);

  const data = (req.data ?? {}) as Record<string, unknown>;
  const name = asString(data.name);
  if (!name) {
    throw new HttpsError("invalid-argument", "name is required");
  }

  const status = asString(data.status) ?? "draft";
  if (!PROJECT_STATUSES.has(status)) {
    throw new HttpsError("invalid-argument", "Invalid project status");
  }

  const referenceLinks = asArray<Record<string, unknown>>(data.referenceLinks)
    .map((item) => ({label: asString(item.label) ?? "", url: asString(item.url) ?? ""}))
    .filter((item) => item.label.length > 0 && item.url.length > 0);

  const volunteers = asArray<Record<string, unknown>>(data.volunteers)
    .map((item) => ({
      uid: asString(item.uid) ?? "",
      displayName: asString(item.displayName),
      role: asString(item.role),
    }))
    .filter((item) => item.uid.length > 0);

  const volunteerUids = Array.from(new Set(volunteers.map((item) => item.uid)));

  const payload = {
    name,
    description: asString(data.description) ?? null,
    status,
    referenceLinks,
    volunteers,
    volunteerUids,
    notes: asString(data.notes) ?? null,
    createdByUid: actor.uid,
    createdByDisplayName: actor.displayName,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  };

  const db = getFirestore();
  const ref = await db.collection("projects").add(payload);
  return {success: true, id: ref.id};
});
