import { onCall, HttpsError } from "firebase-functions/v2/https";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { getApp } from "firebase-admin/app";
import { getInvokeId } from "../utils/invoke";
import {
  deleteAttachmentRecord,
  listAttachmentsForEntity,
  normalizeAttachmentRetention,
} from "../attachments/attachmentModel";
import {
  ARCHIVEABLE_STATUSES,
  assertDeviceRequestNotArchived,
  isDeviceRequestArchived,
  requireAdminRole,
} from "./deviceRequestArchive";

const REGION = "europe-west1";

/**
 * Archivia una device request terminale (`completata`/`annullata`).
 * Flag additivo `archived: true` — lo status non cambia.
 * Opzionale: purge degli allegati `transient`.
 */
export const archiveDeviceRequest = onCall({ region: REGION }, async (request) => {
  const invokeId = getInvokeId(request);
  console.log(`[archiveDeviceRequest] Invoke ID: ${invokeId} - Function called`);

  const uid = request.auth?.uid;
  if (!uid) {
    throw new HttpsError("unauthenticated", "User must be authenticated");
  }

  const { requestId, purgeTransientAttachments, note } = (request.data ?? {}) as {
    requestId?: string;
    purgeTransientAttachments?: boolean;
    note?: string;
  };

  if (!requestId || typeof requestId !== "string") {
    throw new HttpsError("invalid-argument", "Missing parameter: requestId");
  }

  const db = getFirestore();
  await requireAdminRole(db, uid);

  const requestRef = db.collection("deviceRequests").doc(requestId);
  const snap = await requestRef.get();
  if (!snap.exists) {
    throw new HttpsError("not-found", "Request not found");
  }

  const data = snap.data() ?? {};
  if (isDeviceRequestArchived(data)) {
    throw new HttpsError("failed-precondition", "La richiesta è già archiviata");
  }
  if (!ARCHIVEABLE_STATUSES.has(data.status)) {
    throw new HttpsError(
      "failed-precondition",
      "Si possono archiviare solo richieste completate o annullate"
    );
  }

  await db.runTransaction(async (tx) => {
    tx.update(requestRef, {
      archived: true,
      archivedAt: FieldValue.serverTimestamp(),
      archivedBy: uid,
      updatedAt: FieldValue.serverTimestamp(),
    });
    tx.set(requestRef.collection("events").doc(), {
      type: "archive",
      fromStatus: data.status,
      toStatus: data.status,
      timestamp: FieldValue.serverTimestamp(),
      createdBy: uid,
      note: note ?? null,
      purgeTransientAttachments: purgeTransientAttachments === true,
    });
  });

  let purgedCount = 0;
  const purgeErrors: string[] = [];

  if (purgeTransientAttachments === true) {
    const attachments = await listAttachmentsForEntity(db, "deviceRequests", requestId);
    const transient = attachments.filter(
      (a) => normalizeAttachmentRetention(a.retention) === "transient"
    );

    const projectId = getApp().options.projectId;
    if (!projectId) {
      throw new HttpsError("internal", "Project ID is required");
    }
    const bucket = getStorage().bucket(`${projectId}-attachments`);

    for (const attachment of transient) {
      try {
        if (attachment.storagePath) {
          await bucket.file(attachment.storagePath).delete({ ignoreNotFound: true });
        }
        if (!attachment.entityCollectionPath) {
          purgeErrors.push(`${attachment.id}: missing entityCollectionPath`);
          continue;
        }
        await deleteAttachmentRecord(
          db,
          attachment.entityCollectionPath,
          attachment.id,
          attachment.entityId
        );
        purgedCount += 1;
      } catch (err) {
        console.error(`[archiveDeviceRequest] purge failed for ${attachment.id}:`, err);
        purgeErrors.push(attachment.id);
      }
    }
  }

  console.log(
    `[archiveDeviceRequest] OK: request ${requestId} archived by ${uid}` +
      (purgeTransientAttachments ? ` (purged ${purgedCount} transient)` : "")
  );

  return {
    requestId,
    archived: true,
    purgedTransientCount: purgedCount,
    purgeErrors,
  };
});

/**
 * Ripristina una device request archiviata (`archived: false`).
 * Lo status resta invariato; gli allegati già eliminati non vengono ripristinati.
 */
export const restoreDeviceRequest = onCall({ region: REGION }, async (request) => {
  const invokeId = getInvokeId(request);
  console.log(`[restoreDeviceRequest] Invoke ID: ${invokeId} - Function called`);

  const uid = request.auth?.uid;
  if (!uid) {
    throw new HttpsError("unauthenticated", "User must be authenticated");
  }

  const { requestId, note } = (request.data ?? {}) as {
    requestId?: string;
    note?: string;
  };

  if (!requestId || typeof requestId !== "string") {
    throw new HttpsError("invalid-argument", "Missing parameter: requestId");
  }

  const db = getFirestore();
  await requireAdminRole(db, uid);

  const requestRef = db.collection("deviceRequests").doc(requestId);
  const snap = await requestRef.get();
  if (!snap.exists) {
    throw new HttpsError("not-found", "Request not found");
  }

  const data = snap.data() ?? {};
  if (!isDeviceRequestArchived(data)) {
    throw new HttpsError("failed-precondition", "La richiesta non è archiviata");
  }

  await db.runTransaction(async (tx) => {
    tx.update(requestRef, {
      archived: false,
      archivedAt: FieldValue.delete(),
      archivedBy: FieldValue.delete(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    tx.set(requestRef.collection("events").doc(), {
      type: "restore",
      fromStatus: data.status,
      toStatus: data.status,
      timestamp: FieldValue.serverTimestamp(),
      createdBy: uid,
      note: note ?? null,
    });
  });

  console.log(`[restoreDeviceRequest] OK: request ${requestId} restored by ${uid}`);
  return { requestId, archived: false };
});

/** Re-export for tests that need the assertion without calling CF. */
export { assertDeviceRequestNotArchived, isDeviceRequestArchived };
