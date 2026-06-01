import {onCall} from "firebase-functions/v2/https";
import {getFirestore} from "firebase-admin/firestore";
import {
  REGION,
  asString,
  ensureAdmin,
  ensureAuthenticated,
  getActorContext,
} from "./helpers";

export const listVolunteerOptions = onCall({region: REGION}, async (req) => {
  const uid = ensureAuthenticated(req.auth);
  const actor = await getActorContext(uid);
  ensureAdmin(actor);

  const db = getFirestore();
  const usersSnap = await db.collection("users").get();

  const options = await Promise.all(
    usersSnap.docs
      .filter((userDoc) => {
        const role = asString(userDoc.data()?.role);
        return role === "volunteer" || role === "admin";
      })
      .map(async (userDoc) => {
        const profileSnap = await db.collection("users").doc(userDoc.id).collection("private").doc("profile").get();
        const profile = profileSnap.exists ? profileSnap.data() ?? {} : {};
        const firstName = asString(profile.firstName) ?? "";
        const lastName = asString(profile.lastName) ?? "";
        const email = asString(userDoc.data()?.email);
        const displayName = `${firstName} ${lastName}`.trim() || email || userDoc.id;

        return {
          uid: userDoc.id,
          displayName,
          email: email ?? null,
        };
      })
  );

  return {volunteers: options};
});
