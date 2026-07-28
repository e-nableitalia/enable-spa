import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore } from "firebase-admin/firestore";
import { logSecurityEvent } from "../security/securityLog";
import { getInvokeId } from "../utils/invoke";

const REGION = "europe-west1";

interface TemplateItem {
  title: string;
  quantity: number | null;
}

interface TemplateResponse {
  id: string;
  title: unknown;
  items: TemplateItem[];
}

/**
 * Cloud Function callable per la lettura dell'elenco dei template di
 * checklist nel core Organizer, filtrati per categoria.
 *
 * Riceve dal consumer:
 * - `category`: identificatore di categoria opaco (il core non ne conosce
 *   il significato, es. per i device sarà il `devicetype`).
 *
 * Interroga la collection `templates` filtrando per `category` e restituisce
 * al consumer l'elenco dei template trovati con `id`, `title` e `items`.
 */
export const listTemplates = onCall(
  { region: REGION },
  async (request) => {
    const invokeId = getInvokeId(request);
    console.log(`[listTemplates] Invoke ID: ${invokeId} - Function called`);
    try {
      if (!request.auth) {
        console.log("[listTemplates] KO: Unauthenticated");
        throw new HttpsError("unauthenticated", "Authentication required");
      }

      const data = request.data ?? {};
      const { category } = data;

      if (!category || typeof category !== "string") {
        console.log("[listTemplates] KO: Missing or invalid category");
        throw new HttpsError("invalid-argument", "Missing or invalid category");
      }

      const db = getFirestore();
      const snapshot = await db
        .collection("templates")
        .where("category", "==", category)
        .get();

      const templates: TemplateResponse[] = snapshot.docs.map((doc) => {
        const docData = doc.data() ?? {};
        return {
          id: doc.id,
          title: docData.title,
          items: Array.isArray(docData.items) ? docData.items : [],
        };
      });

      await logSecurityEvent({
        type: "system",
        action: "list_templates",
        outcome: "success",
        severity: "low",
        actor: { uid: request.auth.uid, email: request.auth.token?.email ?? undefined },
        context: { function: "listTemplates", invokeId },
      });

      console.log(`[listTemplates] OK: ${templates.length} template(s) found for category ${category}`);
      return { templates };
    } catch (error) {
      console.error("[listTemplates] KO:", error);
      await logSecurityEvent({
        type: "system",
        action: "list_templates_failed",
        outcome: "failure",
        severity: "high",
        actor: { uid: request.auth?.uid, email: request.auth?.token?.email ?? undefined },
        context: { function: "listTemplates", invokeId },
      });

      if (error instanceof HttpsError) {
        throw error;
      }

      throw new HttpsError("internal", "Internal Server Error");
    }
  }
);
