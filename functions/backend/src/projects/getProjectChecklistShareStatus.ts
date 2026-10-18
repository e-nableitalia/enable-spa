import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore } from "firebase-admin/firestore";
import { getInvokeId } from "../utils/invoke";
import { logSecurityEvent } from "../security/securityLog";
import { isChecklistItemComplete, ChecklistItemLike } from "../organizer/checklistCompleteness";
import { resolveChecklistItems } from "../organizer/resolveChecklistItems";
import { normalizeProjectRecord } from "./projectAccess";

const REGION = "europe-west1";

interface ShareChecklistItemLike extends ChecklistItemLike {
  title?: string;
}

/**
 * Cloud Function callable pubblica: risolve un token di condivisione
 * checklist progetto e restituisce solo avanzamento percentuale + elenco
 * semplificato item (title/completed), senza dettagli interni.
 */
export const getProjectChecklistShareStatus = onCall(
  { region: REGION },
  async (request) => {
    const invokeId = getInvokeId(request);
    console.log(`[getProjectChecklistShareStatus] Invoke ID: ${invokeId} - Function called`);
    const ip = request.rawRequest?.ip ?? "unknown";

    try {
      const { token } = request.data as { token?: string };
      if (!token || typeof token !== "string") {
        throw new HttpsError("invalid-argument", "Missing parameter: token");
      }

      const db = getFirestore();
      const linkSnap = await db.collection("projectChecklistShareLinks").doc(token).get();
      if (!linkSnap.exists) {
        throw new HttpsError("not-found", "Share link not found");
      }

      const linkData = linkSnap.data() ?? {};
      const checklistId = linkData.checklistId;
      if (!checklistId || typeof checklistId !== "string") {
        throw new HttpsError("not-found", "Share link not found");
      }

      let projectTitle: string | null = null;
      const projectId = linkData.projectId;
      if (typeof projectId === "string" && projectId) {
        const projectSnap = await db.collection("projects").doc(projectId).get();
        if (projectSnap.exists) {
          const normalized = normalizeProjectRecord(projectSnap.data() as Record<string, unknown>);
          projectTitle = normalized.title || null;
        }
      }

      const checklistSnap = await db.collection("checklists").doc(checklistId).get();
      if (!checklistSnap.exists) {
        throw new HttpsError("not-found", "Checklist not found");
      }

      const data = checklistSnap.data() ?? {};
      const itemIds: string[] = Array.isArray(data.items) ? data.items : [];
      const items = (await resolveChecklistItems(db, itemIds)) as unknown as ShareChecklistItemLike[];
      const totalItems = items.length;
      const completedItems = items.filter(isChecklistItemComplete).length;
      const percentComplete = totalItems === 0 ? 100 : Math.round((completedItems / totalItems) * 100);
      const itemsSummary = items.map((item) => ({
        title: typeof item.title === "string" ? item.title : "",
        completed: isChecklistItemComplete(item),
      }));

      await logSecurityEvent({
        type: "system",
        action: "get_project_checklist_share_status",
        outcome: "success",
        severity: "low",
        actor: { ip },
        context: { function: "getProjectChecklistShareStatus", invokeId },
      });

      console.log(
        `[getProjectChecklistShareStatus] OK: token ${token} percentComplete=${percentComplete}`
      );
      return { percentComplete, items: itemsSummary, projectTitle };
    } catch (error) {
      console.error("[getProjectChecklistShareStatus] KO:", error);
      await logSecurityEvent({
        type: "system",
        action: "get_project_checklist_share_status_failed",
        outcome: "failure",
        severity: "medium",
        actor: { ip },
        context: { function: "getProjectChecklistShareStatus", invokeId },
      });
      if (error instanceof HttpsError) throw error;
      throw new HttpsError("internal", "Internal Server Error");
    }
  }
);
