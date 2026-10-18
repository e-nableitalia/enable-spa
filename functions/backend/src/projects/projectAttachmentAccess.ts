import { HttpsError } from "firebase-functions/v2/https";
import type { Firestore } from "firebase-admin/firestore";
import { getAttachmentById, type AttachmentRecord } from "../attachments/attachmentModel";
import {
  assertProjectContentWritable,
  getProjectOrThrow,
  requireStaffRole,
} from "./projectAccess";

/**
 * Accesso agli allegati collegati ai progetti:
 * - lettura (list/download): qualunque staff (admin o volontario),
 * - upload: qualunque staff su progetto modificabile (new/active),
 * - update/delete: admin su qualunque allegato, volontario solo sui propri.
 */
export async function resolveProjectAttachmentReadAccess(
  db: Firestore,
  uid: string,
  projectId: string
): Promise<void> {
  await requireStaffRole(db, uid);
  await getProjectOrThrow(db, projectId);
}

export async function resolveProjectAttachmentWriteAccess(
  db: Firestore,
  uid: string,
  projectId: string
): Promise<"admin" | "volunteer"> {
  const role = await requireStaffRole(db, uid);
  const project = await getProjectOrThrow(db, projectId);
  assertProjectContentWritable(project.status);
  return role;
}

/**
 * Variante usata quando il chiamante passa un attachmentId già esistente:
 * verifica accesso al progetto e appartenenza reale dell'allegato.
 */
export async function resolveProjectAttachment(
  db: Firestore,
  uid: string,
  projectId: string,
  attachmentId: string,
  options?: { forWrite?: boolean }
): Promise<AttachmentRecord> {
  let role: "admin" | "volunteer" | undefined;
  if (options?.forWrite) {
    role = await resolveProjectAttachmentWriteAccess(db, uid, projectId);
  } else {
    await resolveProjectAttachmentReadAccess(db, uid, projectId);
  }

  const attachment = await getAttachmentById(db, attachmentId);
  if (!attachment) {
    throw new HttpsError("not-found", "Attachment not found");
  }
  if (attachment.entityType !== "project" || attachment.entityId !== projectId) {
    throw new HttpsError("not-found", "Attachment not linked to this project");
  }
  if (options?.forWrite && role !== "admin" && attachment.uploadedBy !== uid) {
    throw new HttpsError(
      "permission-denied",
      "Volunteers can modify or delete only their own project attachments"
    );
  }

  return attachment;
}
