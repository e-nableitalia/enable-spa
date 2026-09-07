import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { getInvokeId } from "../utils/invoke";
import { logSecurityEvent } from "../security/securityLog";

const REGION = "europe-west1";

type LogOutcome = "success" | "blocked" | "failure";

/**
 * Cloud Function callable del dominio "projects" (EA-169/170): crea un
 * nuovo progetto/iniziativa/evento (`projects/{projectId}`), admin-only.
 *
 * Stato iniziale sempre `"new"`, `checklists` vuoto — le checklist si
 * aggiungono con `createProjectChecklist` in un secondo momento.
 */
export const createProject = onCall({ region: REGION }, async (request) => {
  const invokeId = getInvokeId(request);
  console.log(`[createProject] Invoke ID: ${invokeId} - Function called`);

  const uid = request.auth?.uid;
  const email = request.auth?.token?.email;

  async function logOutcome(outcome: LogOutcome, metadata: Record<string, unknown>): Promise<void> {
    await logSecurityEvent({
      type: "system",
      action: "createProject",
      outcome,
      severity: outcome === "success" ? "low" : outcome === "failure" ? "high" : "medium",
      actor: { uid, email: email ?? undefined },
      context: { function: "createProject", invokeId, metadata },
    });
  }

  if (!uid) {
    console.log("[createProject] KO: Unauthenticated");
    await logOutcome("blocked", { reason: "unauthenticated" });
    throw new HttpsError("unauthenticated", "Authentication required");
  }

  const { title, description, projectType } = (request.data ?? {}) as {
    title?: string;
    description?: string;
    projectType?: string;
  };

  if (!title || typeof title !== "string" || !title.trim()) {
    await logOutcome("blocked", { reason: "invalid-argument", field: "title" });
    throw new HttpsError("invalid-argument", "Missing or invalid title");
  }
  if (!projectType || typeof projectType !== "string" || !projectType.trim()) {
    await logOutcome("blocked", { reason: "invalid-argument", field: "projectType" });
    throw new HttpsError("invalid-argument", "Missing or invalid projectType");
  }
  if (description !== undefined && typeof description !== "string") {
    await logOutcome("blocked", { reason: "invalid-argument", field: "description" });
    throw new HttpsError("invalid-argument", "description must be a string");
  }

  const db = getFirestore();

  const userSnap = await db.collection("users").doc(uid).get();
  const role = userSnap.exists ? userSnap.data()?.role : undefined;
  if (role !== "admin") {
    console.log(`[createProject] KO: Permission denied for uid ${uid}`);
    await logOutcome("blocked", { reason: "permission-denied", role: role ?? null });
    throw new HttpsError("permission-denied", "Only admin can perform this action");
  }

  try {
    const projectRef = db.collection("projects").doc();
    await projectRef.set({
      title: title.trim(),
      description: description ?? "",
      projectType,
      status: "new",
      checklists: [],
      createdBy: uid,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    console.log(`[createProject] OK: project ${projectRef.id} created by ${uid}`);
    await logOutcome("success", { projectId: projectRef.id, projectType });

    return { projectId: projectRef.id };
  } catch (error) {
    console.error("[createProject] KO:", error);
    await logOutcome("failure", { reason: "unexpected-error" });

    if (error instanceof HttpsError) {
      throw error;
    }
    throw new HttpsError("internal", "Internal Server Error");
  }
});
