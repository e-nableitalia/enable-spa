import { onCall, HttpsError } from "firebase-functions/v2/https";
import type { CallableRequest } from "firebase-functions/v2/https";
import { getFirestore } from "firebase-admin/firestore";
import { getInvokeId } from "../utils/invoke";
import { uploadAttachment } from "../attachments/uploadAttachment";
import { resolveProjectAttachmentWriteAccess } from "./projectAttachmentAccess";

const REGION = "europe-west1";

export const uploadProjectAttachment = onCall({ region: REGION }, async (request) => {
  const invokeId = getInvokeId(request);
  console.log(`[uploadProjectAttachment] Invoke ID: ${invokeId} - Function called`);

  const uid = request.auth?.uid;
  if (!uid) {
    throw new HttpsError("unauthenticated", "User must be authenticated");
  }

  const { projectId, fileName, description, notes, category, retention, size } = request.data as {
    projectId?: string;
    fileName?: string;
    description?: string;
    notes?: string;
    category?: string;
    retention?: string;
    size?: number;
  };

  if (!projectId || typeof projectId !== "string") {
    throw new HttpsError("invalid-argument", "Missing parameter: projectId");
  }

  const db = getFirestore();
  await resolveProjectAttachmentWriteAccess(db, uid, projectId);

  return uploadAttachment.run({
    ...request,
    data: {
      entityType: "project",
      entityId: projectId,
      entityCollectionPath: "projects",
      fileName,
      description,
      notes,
      category,
      retention,
      size,
    },
  } as CallableRequest) as Promise<{ attachmentId: string; uploadUrl: string; storagePath: string }>;
});
