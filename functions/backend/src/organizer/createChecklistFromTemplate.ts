import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import crypto from "crypto";
import { logSecurityEvent } from "../security/securityLog";
import { getInvokeId } from "../utils/invoke";

const REGION = "europe-west1";

/**
 * Stato di un item di checklist. Vedi createChecklist.ts per la nota sul
 * significato (assente) che il core Organizer attribuisce a questi valori.
 */
const CHECKLIST_ITEM_STATUSES = ["Assegnare", "Da iniziare", "In corso", "Completata"] as const;
type ChecklistItemStatus = typeof CHECKLIST_ITEM_STATUSES[number];

interface ChecklistItem {
  id: string;
  title: string;
  assignee: string | null;
  quantity: number | null;
  notes: string;
  status: ChecklistItemStatus;
  completed: boolean;
}

interface TemplateItem {
  title: unknown;
  quantity: unknown;
}

/**
 * Clona un item di template in un nuovo `ChecklistItem` di istanza.
 *
 * Logica di clonazione (Epic EA-3): titolo e quantità vengono copiati dal
 * template, mentre stato, assegnatario e flag di completamento vengono
 * sempre azzerati, indipendentemente da cosa contenesse il template (un
 * template non ha comunque questi campi, essendo un catalogo di
 * riferimento, non un'istanza).
 */
function cloneTemplateItem(templateItem: TemplateItem): ChecklistItem {
  const title = typeof templateItem?.title === "string" ? templateItem.title : "";
  const quantity = typeof templateItem?.quantity === "number" ? templateItem.quantity : null;

  return {
    id: crypto.randomUUID(),
    title,
    assignee: null,
    quantity,
    notes: "",
    status: CHECKLIST_ITEM_STATUSES[0],
    completed: false,
  };
}

/**
 * Cloud Function callable per l'istanziazione di una nuova checklist a
 * partire da un template del catalogo, nel core Organizer.
 *
 * Riceve dal consumer:
 * - `templateId`: identificatore del template da cui istanziare.
 * - `title`: titolo della nuova istanza di checklist.
 * - `category` (opzionale): identificatore di categoria opaco con cui
 *   sovrascrivere quello del template. Se omesso, la categoria è ereditata
 *   dal template.
 *
 * Copia gli item del template nella nuova istanza (titolo e quantità
 * copiati, stato impostato ad 'Assegnare', assegnatario a null e flag di
 * completamento a false su ciascun item clonato). Registra `fromTemplate:
 * <templateId>` come riferimento storico, non come dipendenza viva: il
 * template può essere modificato o eliminato in seguito senza che
 * l'istanza ne risenta.
 *
 * Crea un documento in `checklists/{checklistId}` e restituisce il
 * `checklistId` generato al consumer.
 */
export const createChecklistFromTemplate = onCall(
  { region: REGION },
  async (request) => {
    const invokeId = getInvokeId(request);
    console.log(`[createChecklistFromTemplate] Invoke ID: ${invokeId} - Function called`);
    try {
      if (!request.auth) {
        console.log("[createChecklistFromTemplate] KO: Unauthenticated");
        throw new HttpsError("unauthenticated", "Authentication required");
      }
      const uid = request.auth.uid;

      const data = request.data ?? {};
      const { templateId, title, category } = data;

      if (!templateId || typeof templateId !== "string") {
        console.log("[createChecklistFromTemplate] KO: Missing or invalid templateId");
        throw new HttpsError("invalid-argument", "Missing or invalid templateId");
      }

      if (!title || typeof title !== "string") {
        console.log("[createChecklistFromTemplate] KO: Missing or invalid title");
        throw new HttpsError("invalid-argument", "Missing or invalid title");
      }

      if (category !== undefined && category !== null && typeof category !== "string") {
        console.log("[createChecklistFromTemplate] KO: category must be a string");
        throw new HttpsError("invalid-argument", "category must be a string");
      }

      const db = getFirestore();
      const templateRef = db.collection("templates").doc(templateId);
      const templateSnap = await templateRef.get();

      if (!templateSnap.exists) {
        console.log(`[createChecklistFromTemplate] KO: template ${templateId} not found`);
        throw new HttpsError("not-found", "Template not found");
      }

      const templateData = templateSnap.data() ?? {};
      const templateItems: TemplateItem[] = Array.isArray(templateData.items) ? templateData.items : [];
      const clonedItems: ChecklistItem[] = templateItems.map(cloneTemplateItem);

      const resolvedCategory = (category as string | undefined) ?? templateData.category;

      const checklistRef = db.collection("checklists").doc();

      console.log(
        `[createChecklistFromTemplate] Creating checklist document ${checklistRef.id} from template ${templateId}`
      );
      await checklistRef.set({
        category: resolvedCategory,
        title,
        items: clonedItems,
        fromTemplate: templateId,
        createdBy: uid,
        createdAt: FieldValue.serverTimestamp(),
      });

      await logSecurityEvent({
        type: "system",
        action: "create_checklist_from_template",
        outcome: "success",
        severity: "low",
        actor: { uid, email: request.auth.token?.email ?? undefined },
        context: { function: "createChecklistFromTemplate", invokeId, requestId: checklistRef.id },
      });

      console.log(
        `[createChecklistFromTemplate] OK: checklist ${checklistRef.id} created from template ${templateId}`
      );
      return { checklistId: checklistRef.id };
    } catch (error) {
      console.error("[createChecklistFromTemplate] KO:", error);
      await logSecurityEvent({
        type: "system",
        action: "create_checklist_from_template_failed",
        outcome: "failure",
        severity: "high",
        actor: { uid: request.auth?.uid, email: request.auth?.token?.email ?? undefined },
        context: { function: "createChecklistFromTemplate", invokeId },
      });

      if (error instanceof HttpsError) {
        throw error;
      }

      throw new HttpsError("internal", "Internal Server Error");
    }
  }
);
