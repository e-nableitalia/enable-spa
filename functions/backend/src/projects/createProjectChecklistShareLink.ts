import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import crypto from "crypto";
import { getInvokeId } from "../utils/invoke";
import { logSecurityEvent } from "../security/securityLog";
import { requireStaffRole, getProjectOrThrow, assertChecklistBelongsToProject } from "./projectAccess";

const REGION = "europe-west1";
const SHARE_BASE_URL = "https://app.e-nableitalia.it";

/**
 * Cloud Function callable del dominio "projects": genera (o riusa) un link
 * pubblico read-only della checklist collegata a un progetto.
 *
 * Perimetro accesso: staff-only (admin/volunteer), con verifica esplicita
 * che la checklist sia realmente collegata al progetto richiesto.
 */
export const createProjectChecklistShareLink = onCall(
  { region: REGION },
  async (request) => {
    const invokeId = getInvokeId(request);
    console.log(`[createProjectChecklistShareLink] Invoke ID: ${invokeId} - Function called`);

    const uid = request.auth?.uid;
    if (!uid) {
      throw new HttpsError("unauthenticated", "User must be authenticated");
    }

    const { projectId, checklistId } = request.data as { projectId?: string; checklistId?: string };
    if (!projectId || typeof projectId !== "string") {
      throw new HttpsError("invalid-argument", "Missing parameter: projectId");
    }
    if (!checklistId || typeof checklistId !== "string") {
      throw new HttpsError("invalid-argument", "Missing parameter: checklistId");
    }

    const db = getFirestore();
    await requireStaffRole(db, uid);
    const project = await getProjectOrThrow(db, projectId);
    assertChecklistBelongsToProject(project, checklistId);

    const existingSnap = await db
      .collection("projectChecklistShareLinks")
      .where("checklistId", "==", checklistId)
      .limit(1)
      .get();

    let token: string;
    if (!existingSnap.empty) {
      token = existingSnap.docs[0].id;
      console.log(
        `[createProjectChecklistShareLink] Reusing existing share link ${token} for checklist ${checklistId}`
      );
    } else {
      token = crypto.randomUUID();
      await db.collection("projectChecklistShareLinks").doc(token).set({
        checklistId,
        projectId,
        createdAt: FieldValue.serverTimestamp(),
        createdBy: uid,
      });
      console.log(
        `[createProjectChecklistShareLink] Created share link ${token} for checklist ${checklistId} by ${uid}`
      );
    }

    await logSecurityEvent({
      type: "system",
      action: "create_project_checklist_share_link",
      outcome: "success",
      severity: "low",
      actor: { uid, email: request.auth?.token?.email ?? undefined },
      context: { function: "createProjectChecklistShareLink", invokeId, metadata: { projectId } },
    });

    return { token, url: `${SHARE_BASE_URL}/project-checklist-share/${token}` };
  }
);
