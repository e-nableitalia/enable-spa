import { onCall, HttpsError } from "firebase-functions/v2/https";
import type { CallableRequest } from "firebase-functions/v2/https";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { getInvokeId } from "../utils/invoke";
import { logSecurityEvent } from "../security/securityLog";
import { createChecklist } from "../organizer/createChecklist";
import { createChecklistFromTemplate } from "../organizer/createChecklistFromTemplate";
import { requireAdmin, getProjectOrThrow, assertProjectContentWritable } from "./projectAccess";

const REGION = "europe-west1";

type LogOutcome = "success" | "blocked" | "failure";

/**
 * Cloud Function callable del dominio "projects": crea una checklist
 * Organizer collegata a un progetto e ne aggiunge il riferimento
 * `{checklistId, label}` all'array `projects/{projectId}.checklists`.
 *
 * Admin-only, bloccata fuori da `new`/`active`
 * (`assertProjectContentWritable`). Categoria della checklist =
 * `projectType` del progetto (stesso principio di `device-requests`, che
 * usa il `devicetype` della richiesta) — passata come `origin: {type:
 * "project", id: projectId}` al core Organizer per permettere il leak
 * verso `listMyChecklistItems` (comportamento voluto, non un effetto
 * collaterale).
 *
 * Se `templateId` è presente, la checklist viene istanziata da quel
 * template esplicito (`createChecklistFromTemplate`); altrimenti viene
 * creata vuota (`createChecklist`) — nessun auto-lookup implicito per
 * `projectType`, a differenza del fallback legacy di device-requests: qui
 * la scelta del template è sempre esplicita lato consumer.
 */
export const createProjectChecklist = onCall({ region: REGION }, async (request) => {
  const invokeId = getInvokeId(request);
  console.log(`[createProjectChecklist] Invoke ID: ${invokeId} - Function called`);

  const uid = request.auth?.uid;
  const email = request.auth?.token?.email;

  async function logOutcome(outcome: LogOutcome, metadata: Record<string, unknown>): Promise<void> {
    await logSecurityEvent({
      type: "system",
      action: "createProjectChecklist",
      outcome,
      severity: outcome === "success" ? "low" : outcome === "failure" ? "high" : "medium",
      actor: { uid, email: email ?? undefined },
      context: { function: "createProjectChecklist", invokeId, metadata },
    });
  }

  if (!uid) {
    await logOutcome("blocked", { reason: "unauthenticated" });
    throw new HttpsError("unauthenticated", "Authentication required");
  }

  const { projectId, label, title, templateId } = (request.data ?? {}) as {
    projectId?: string;
    label?: string;
    title?: string;
    templateId?: string;
  };

  if (!projectId || typeof projectId !== "string") {
    await logOutcome("blocked", { reason: "invalid-argument", field: "projectId" });
    throw new HttpsError("invalid-argument", "Missing or invalid projectId");
  }
  if (!label || typeof label !== "string" || !label.trim()) {
    await logOutcome("blocked", { reason: "invalid-argument", field: "label" });
    throw new HttpsError("invalid-argument", "Missing or invalid label");
  }
  if (!title || typeof title !== "string" || !title.trim()) {
    await logOutcome("blocked", { reason: "invalid-argument", field: "title" });
    throw new HttpsError("invalid-argument", "Missing or invalid title");
  }
  if (templateId !== undefined && typeof templateId !== "string") {
    await logOutcome("blocked", { reason: "invalid-argument", field: "templateId" });
    throw new HttpsError("invalid-argument", "templateId must be a string");
  }

  const db = getFirestore();

  try {
    await requireAdmin(db, uid);
  } catch (error) {
    await logOutcome("blocked", { reason: "permission-denied", projectId });
    throw error;
  }

  try {
    const project = await getProjectOrThrow(db, projectId);
    assertProjectContentWritable(project.status);

    const origin = { type: "project", id: projectId };
    let checklistId: string;

    if (templateId) {
      const result = await createChecklistFromTemplate.run({
        ...request,
        data: { templateId, title: title.trim(), category: project.projectType, origin },
      } as CallableRequest);
      checklistId = (result as { checklistId: string }).checklistId;
    } else {
      const result = await createChecklist.run({
        ...request,
        data: { category: project.projectType, title: title.trim(), items: [], origin },
      } as CallableRequest);
      checklistId = (result as { checklistId: string }).checklistId;
    }

    await db.collection("projects").doc(projectId).update({
      checklists: FieldValue.arrayUnion({ checklistId, label: label.trim() }),
      updatedAt: FieldValue.serverTimestamp(),
    });

    console.log(`[createProjectChecklist] OK: checklist ${checklistId} linked to project ${projectId}`);
    await logOutcome("success", { projectId, checklistId });

    return { checklistId };
  } catch (error) {
    if (error instanceof HttpsError) {
      await logOutcome("blocked", { reason: error.code, projectId });
      throw error;
    }
    console.error("[createProjectChecklist] KO:", error);
    await logOutcome("failure", { reason: "unexpected-error", projectId });
    throw new HttpsError("internal", "Internal Server Error");
  }
});
