/**
 * Smoke E2E su staging: upload GCS real (persistent + transient),
 * archiveDeviceRequest con purge, restoreDeviceRequest, cleanup.
 *
 * Uso:
 *   GOOGLE_APPLICATION_CREDENTIALS=../../priv/enableitalia-staging-*.json \
 *     node scripts/staging-archive-gcs-smoke.mjs
 */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const admin = require("firebase-admin");

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../../..");
const PROJECT_ID = "enableitalia-staging";
const REGION = "europe-west1";
const BUCKET = `${PROJECT_ID}-attachments`;
const API_KEY = "AIzaSyBMrGqs7pOd5MS8ZsI-yir-MvYHMVRn-fo";
const ADMIN_UID = process.env.SMOKE_ADMIN_UID || "0s6zD8e81gOGko88JqYDvsa95Fz1";

const saPath =
  process.env.GOOGLE_APPLICATION_CREDENTIALS ||
  resolve(ROOT, "priv/enableitalia-staging-b18ce9a41f38.json");
const sa = JSON.parse(readFileSync(saPath, "utf8"));

admin.initializeApp({
  credential: admin.credential.cert(sa),
  projectId: PROJECT_ID,
  storageBucket: BUCKET,
});

const db = admin.firestore();
const bucket = admin.storage().bucket(BUCKET);

async function getIdToken(uid) {
  const customToken = await admin.auth().createCustomToken(uid);
  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: customToken, returnSecureToken: true }),
    }
  );
  const json = await res.json();
  if (!json.idToken) {
    throw new Error(`signInWithCustomToken failed: ${JSON.stringify(json)}`);
  }
  return json.idToken;
}

async function callCallable(name, data, idToken) {
  const url = `https://${REGION}-${PROJECT_ID}.cloudfunctions.net/${name}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({ data }),
  });
  const json = await res.json();
  if (!res.ok || json.error) {
    throw new Error(`${name} failed (${res.status}): ${JSON.stringify(json)}`);
  }
  return json.result ?? json.data ?? json;
}

async function createAttachment({ requestId, retention, fileName, contents }) {
  const attRef = db.collection("attachments").doc();
  const attachmentId = attRef.id;
  const storagePath = `attachments/deviceRequest/${requestId}/${attachmentId}/${fileName}`;
  const file = bucket.file(storagePath);
  await file.save(contents, { contentType: "text/plain", resumable: false });

  const fields = {
    id: attachmentId,
    entityType: "deviceRequest",
    entityId: requestId,
    entityCollectionPath: "deviceRequests",
    uploadedBy: ADMIN_UID,
    description: `smoke-${retention}`,
    notes: "",
    category: null,
    retention,
    fileName,
    extension: "txt",
    storagePath,
    size: Buffer.byteLength(contents),
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  const batch = db.batch();
  batch.set(attRef, fields);
  batch.set(
    db.collection("deviceRequests").doc(requestId).collection("attachments").doc(attachmentId),
    {
      attachmentId,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    }
  );
  await batch.commit();

  return { attachmentId, storagePath };
}

async function fileExists(storagePath) {
  const [exists] = await bucket.file(storagePath).exists();
  return exists;
}

async function main() {
  console.log(`==> smoke archive/GCS on ${PROJECT_ID} as admin ${ADMIN_UID}`);

  const reqRef = db.collection("deviceRequests").doc();
  const requestId = reqRef.id;
  await reqRef.set({
    status: "completata",
    archived: false,
    requestNumber: `SMOKE-ARC-${Date.now()}`,
    recipient: "Smoke Archive Test",
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    assignedVolunteers: [],
    checklistIds: [],
  });
  console.log(`created deviceRequest ${requestId}`);

  const persistent = await createAttachment({
    requestId,
    retention: "persistent",
    fileName: "keep-me.txt",
    contents: "persistent payload",
  });
  const transient = await createAttachment({
    requestId,
    retention: "transient",
    fileName: "purge-me.txt",
    contents: "transient payload",
  });
  console.log("uploaded attachments:", { persistent: persistent.attachmentId, transient: transient.attachmentId });

  if (!(await fileExists(persistent.storagePath)) || !(await fileExists(transient.storagePath))) {
    throw new Error("GCS upload verification failed before archive");
  }

  const idToken = await getIdToken(ADMIN_UID);

  const archiveResult = await callCallable(
    "archiveDeviceRequest",
    { requestId, purgeTransientAttachments: true },
    idToken
  );
  console.log("archive result:", archiveResult);

  if (archiveResult.purgedTransientCount !== 1) {
    throw new Error(`expected purgedTransientCount=1, got ${archiveResult.purgedTransientCount}`);
  }

  const snap = await reqRef.get();
  if (snap.data()?.archived !== true) {
    throw new Error("deviceRequest.archived was not set to true");
  }

  const persistentStillThere = await fileExists(persistent.storagePath);
  const transientGone = !(await fileExists(transient.storagePath));
  console.log({ persistentStillThere, transientGone });

  if (!persistentStillThere) throw new Error("persistent file was deleted — unexpected");
  if (!transientGone) throw new Error("transient file still present in GCS after purge");

  const transientDoc = await db.collection("attachments").doc(transient.attachmentId).get();
  if (transientDoc.exists) throw new Error("transient attachment doc still in Firestore");

  const persistentDoc = await db.collection("attachments").doc(persistent.attachmentId).get();
  if (!persistentDoc.exists) throw new Error("persistent attachment doc missing");

  const restoreResult = await callCallable("restoreDeviceRequest", { requestId }, idToken);
  console.log("restore result:", restoreResult);

  const afterRestore = await reqRef.get();
  if (afterRestore.data()?.archived === true) {
    throw new Error("restore did not clear archived flag");
  }

  // Cleanup leftover smoke artifacts
  await bucket.file(persistent.storagePath).delete({ ignoreNotFound: true });
  await db.collection("attachments").doc(persistent.attachmentId).delete().catch(() => {});
  await reqRef.collection("attachments").doc(persistent.attachmentId).delete().catch(() => {});
  await reqRef.collection("attachments").doc(transient.attachmentId).delete().catch(() => {});
  const events = await reqRef.collection("events").get();
  const batch = db.batch();
  events.docs.forEach((d) => batch.delete(d.ref));
  batch.delete(reqRef);
  await batch.commit();

  console.log("==> SMOKE OK");
}

main().catch((err) => {
  console.error("==> SMOKE FAILED", err);
  process.exit(1);
});
