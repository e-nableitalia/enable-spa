import { onCall, HttpsError } from "firebase-functions/v2/https";
import type { CallableRequest } from "firebase-functions/v2/https";
import { getFirestore } from "firebase-admin/firestore";
import { getInvokeId } from "../utils/invoke";
import { downloadAttachment } from "../attachments/downloadAttachment";
import { resolveProjectAttachment } from "./projectAttachmentAccess";

const REGION = "europe-west1";

export const downloadProjectAttachment = onCall({ region: REGION }, async (request) => {
  const invokeId = getInvokeId(request);
  console.log(`[downloadProjectAttachment] Invoke ID: ${invokeId} - Function called`);

  const uid = request.auth?.uid;
  if (!uid) {
    throw new HttpsError("unauthenticated", "User must be authenticated");
  }

  const { projectId, attachmentId } = request.data as {
    projectId?: string;
    attachmentId?: string;
  };
  if (!projectId || typeof projectId !== "string") {
    throw new HttpsError("invalid-argument", "Missing parameter: projectId");
  }
  if (!attachmentId || typeof attachmentId !== "string") {
    throw new HttpsError("invalid-argument", "Missing parameter: attachmentId");
  }

  const db = getFirestore();
  await resolveProjectAttachment(db, uid, projectId, attachmentId);

  return downloadAttachment.run({
    ...request,
    data: { attachmentId },
  } as CallableRequest) as Promise<{ attachmentId: string; downloadUrl: string; fileName: string }>;
});
