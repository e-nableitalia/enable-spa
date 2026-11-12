import { onCall, HttpsError } from "firebase-functions/v2/https";
import type { CallableRequest } from "firebase-functions/v2/https";
import { getFirestore } from "firebase-admin/firestore";
import { getInvokeId } from "../utils/invoke";
import { updateAttachmentDescription } from "../attachments/updateAttachmentDescription";
import { resolveProjectAttachment } from "./projectAttachmentAccess";

const REGION = "europe-west1";

export const updateProjectAttachmentDescription = onCall({ region: REGION }, async (request) => {
  const invokeId = getInvokeId(request);
  console.log(`[updateProjectAttachmentDescription] Invoke ID: ${invokeId} - Function called`);

  const uid = request.auth?.uid;
  if (!uid) {
    throw new HttpsError("unauthenticated", "User must be authenticated");
  }

  const { projectId, attachmentId, description, notes, retention } = request.data as {
    projectId?: string;
    attachmentId?: string;
    description?: string;
    notes?: string;
    retention?: string;
  };
  if (!projectId || typeof projectId !== "string") {
    throw new HttpsError("invalid-argument", "Missing parameter: projectId");
  }
  if (!attachmentId || typeof attachmentId !== "string") {
    throw new HttpsError("invalid-argument", "Missing parameter: attachmentId");
  }

  const db = getFirestore();
  await resolveProjectAttachment(db, uid, projectId, attachmentId, { forWrite: true });

  return updateAttachmentDescription.run({
    ...request,
    data: { attachmentId, description, notes, retention },
  } as CallableRequest) as Promise<{
    attachmentId: string;
    description: string;
    notes: string;
    retention: string;
  }>;
});
