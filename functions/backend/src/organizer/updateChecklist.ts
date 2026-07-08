import {onCall, HttpsError} from "firebase-functions/v2/https";
import {getFirestore, FieldValue} from "firebase-admin/firestore";

const REGION = "europe-west1";

/**
 * Cloud Function callable per l'aggiornamento del titolo di un'istanza di
 * checklist esistente nel core Organizer.
 *
 * Riceve dal consumer:
 * - `checklistId`: identificatore dell'istanza da aggiornare.
 * - `title`: nuovo titolo della checklist.
 *
 * Aggiorna il documento `checklists/{checklistId}` impostando il nuovo
 * `title` e il campo `updatedAt` al timestamp del server.
 */
export const updateChecklist = onCall({region: REGION}, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) {
    throw new HttpsError("unauthenticated", "User must be authenticated");
  }

  const {checklistId, title} = request.data as { checklistId?: string; title?: string };

  if (!checklistId || typeof checklistId !== "string") {
    throw new HttpsError("invalid-argument", "Missing parameter: checklistId");
  }

  if (!title || typeof title !== "string") {
    throw new HttpsError("invalid-argument", "Missing or invalid title");
  }

  const db = getFirestore();
  const checklistRef = db.collection("checklists").doc(checklistId);

  const snap = await checklistRef.get();
  if (!snap.exists) {
    throw new HttpsError("not-found", "Checklist not found");
  }

  await checklistRef.update({
    title,
    updatedAt: FieldValue.serverTimestamp(),
  });

  return {checklistId, title};
});
