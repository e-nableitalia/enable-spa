import { onCall, HttpsError } from "firebase-functions/v2/https";
import type { CallableRequest } from "firebase-functions/v2/https";
import { getFirestore } from "firebase-admin/firestore";
import { getInvokeId } from "../utils/invoke";
import { listAttachments } from "../attachments/listAttachments";
import { resolveProjectAttachmentReadAccess } from "./projectAttachmentAccess";

const REGION = "europe-west1";

export const listProjectAttachments = onCall({ region: REGION }, async (request) => {
  const invokeId = getInvokeId(request);
  console.log(`[listProjectAttachments] Invoke ID: ${invokeId} - Function called`);

  const uid = request.auth?.uid;
  if (!uid) {
    throw new HttpsError("unauthenticated", "User must be authenticated");
  }

  const { projectId } = request.data as { projectId?: string };
  if (!projectId || typeof projectId !== "string") {
    throw new HttpsError("invalid-argument", "Missing parameter: projectId");
  }

  const db = getFirestore();
  await resolveProjectAttachmentReadAccess(db, uid, projectId);

  return listAttachments.run({
    ...request,
    data: {
      entityType: "project",
      entityId: projectId,
      entityCollectionPath: "projects",
    },
  } as CallableRequest) as Promise<{ attachments: unknown[] }>;
});
