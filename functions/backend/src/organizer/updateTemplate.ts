import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { logSecurityEvent } from "../security/securityLog";
import { getInvokeId } from "../utils/invoke";
import { normalizeTemplateItem } from "./templateItem";

const REGION = "europe-west1";

/**
 * Cloud Function callable per l'aggiornamento di un template di checklist
 * esistente nel core Organizer.
 *
 * Riceve dal consumer:
 * - `templateId`: identificatore del template da aggiornare.
 * - `title` (opzionale): nuovo titolo del template.
 * - `items` (opzionale): nuovo elenco di item con cui sostituire quelli
 *   esistenti.
 *
 * Almeno uno tra `title` e `items` deve essere presente. Aggiorna il
 * documento `templates/{templateId}` con i soli campi forniti e imposta
 * `updatedAt` a `FieldValue.serverTimestamp()`.
 */
export const updateTemplate = onCall(
  { region: REGION },
  async (request) => {
    const invokeId = getInvokeId(request);
    console.log(`[updateTemplate] Invoke ID: ${invokeId} - Function called`);
    try {
      if (!request.auth) {
        console.log("[updateTemplate] KO: Unauthenticated");
        throw new HttpsError("unauthenticated", "Authentication required");
      }

      const data = request.data ?? {};
      const { templateId, title, items } = data;

      if (!templateId || typeof templateId !== "string") {
        console.log("[updateTemplate] KO: Missing or invalid templateId");
        throw new HttpsError("invalid-argument", "Missing or invalid templateId");
      }

      const hasTitle = title !== undefined;
      const hasItems = items !== undefined;

      if (!hasTitle && !hasItems) {
        console.log("[updateTemplate] KO: No field to update provided");
        throw new HttpsError("invalid-argument", "At least one of title or items must be provided");
      }

      if (hasTitle && (typeof title !== "string" || !title.trim())) {
        console.log("[updateTemplate] KO: Missing or invalid title");
        throw new HttpsError("invalid-argument", "Missing or invalid title");
      }

      if (hasItems && !Array.isArray(items)) {
        console.log("[updateTemplate] KO: items must be an array");
        throw new HttpsError("invalid-argument", "items must be an array");
      }

      const updates: Record<string, unknown> = {};
      if (hasTitle) {
        updates.title = title;
      }
      if (hasItems) {
        updates.items = (items as unknown[]).map(normalizeTemplateItem);
      }

      const db = getFirestore();
      const templateRef = db.collection("templates").doc(templateId);
      const templateSnap = await templateRef.get();

      if (!templateSnap.exists) {
        console.log(`[updateTemplate] KO: template ${templateId} not found`);
        throw new HttpsError("not-found", "Template not found");
      }

      await templateRef.update({
        ...updates,
        updatedAt: FieldValue.serverTimestamp(),
      });

      await logSecurityEvent({
        type: "system",
        action: "update_template",
        outcome: "success",
        severity: "low",
        actor: { uid: request.auth.uid, email: request.auth.token?.email ?? undefined },
        context: { function: "updateTemplate", invokeId, requestId: templateId },
      });

      console.log(`[updateTemplate] OK: template ${templateId} updated`);
      return { templateId };
    } catch (error) {
      console.error("[updateTemplate] KO:", error);
      await logSecurityEvent({
        type: "system",
        action: "update_template_failed",
        outcome: "failure",
        severity: "high",
        actor: { uid: request.auth?.uid, email: request.auth?.token?.email ?? undefined },
        context: { function: "updateTemplate", invokeId, requestId: request.data?.templateId },
      });

      if (error instanceof HttpsError) {
        throw error;
      }

      throw new HttpsError("internal", "Internal Server Error");
    }
  }
);
