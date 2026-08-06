import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { logSecurityEvent } from "../security/securityLog";
import { getInvokeId } from "../utils/invoke";
import { CHECKLIST_ITEM_STATUSES, ChecklistItemType, isChecklistItemType } from "./checklistItemStatus";

const REGION = "europe-west1";

interface ClonedItemFields {
  title: string;
  type: ChecklistItemType;
  assignee: null;
  quantity: number | null;
  notes: string;
  status: typeof CHECKLIST_ITEM_STATUSES[number];
  completed: false;
}

/**
 * Clona un item di template (catalogo, non toccato da EA-137: resta un
 * array embedded su `templates/{id}.items`) in un nuovo item per la nuova
 * istanza.
 *
 * Logica di clonazione invariata (Epic EA-3, aggiornata da EA-126): titolo,
 * type e quantità vengono copiati dal template, mentre stato, assegnatario,
 * note e flag di completamento vengono sempre azzerati, indipendentemente
 * da cosa contenesse il template (un template non ha comunque questi
 * campi, essendo un catalogo di riferimento, non un'istanza).
 *
 * `type` è garantito valorizzato su ogni item di template a valle di EA-125
 * (`normalizeTemplateItem` lo richiede e valida in creazione/modifica). Per
 * i template creati prima di EA-125 (privi di `type` in Firestore), si
 * applica lo stesso default transitorio `"generic"` già usato altrove per
 * dati storici (vedi `docs/FINDINGS.md` F-8), invece di propagare un
 * `undefined` che romperebbe l'invariante "type sempre valorizzato" sulla
 * nuova istanza.
 */
function cloneTemplateItem(templateItem: Record<string, unknown>): ClonedItemFields {
  const title = typeof templateItem?.title === "string" ? templateItem.title : "";
  const type: ChecklistItemType = isChecklistItemType(templateItem?.type) ? templateItem.type : "generic";
  const quantity = typeof templateItem?.quantity === "number" ? templateItem.quantity : null;

  return {
    title,
    type,
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
 * Crea un nuovo documento `checklistItems` per ciascun item del template
 * (titolo, type e quantità copiati, stato impostato ad 'Assegnare',
 * assegnatario a null, flag di completamento a false e i tre campi
 * nullabili `creationDate`/`dueDate`/`completionDate` azzerati a null su
 * ciascun item clonato), con `category` denormalizzata dalla nuova
 * checklist (EA-139: gli item copiati non popolano più direttamente
 * l'array embedded `checklists/{id}.items`, sostituito da un array di soli
 * `itemId` a valle di EA-137). Registra `fromTemplate: <templateId>` come
 * riferimento storico, non come dipendenza viva: il template può essere
 * modificato o eliminato in seguito senza che l'istanza ne risenta.
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
      const templateItems: Record<string, unknown>[] = Array.isArray(templateData.items) ? templateData.items : [];
      const clonedItems: ClonedItemFields[] = templateItems.map(cloneTemplateItem);

      const resolvedCategory = (category as string | undefined) ?? templateData.category;

      const checklistRef = db.collection("checklists").doc();
      const itemRefs = clonedItems.map(() => db.collection("checklistItems").doc());

      console.log(
        `[createChecklistFromTemplate] Creating checklist document ${checklistRef.id} from template ${templateId}`
      );
      const batch = db.batch();
      batch.set(checklistRef, {
        category: resolvedCategory,
        title,
        items: itemRefs.map((itemRef) => itemRef.id),
        fromTemplate: templateId,
        createdBy: uid,
        createdAt: FieldValue.serverTimestamp(),
      });

      itemRefs.forEach((itemRef, index) => {
        batch.set(itemRef, {
          id: itemRef.id,
          checklistId: checklistRef.id,
          category: resolvedCategory,
          ...clonedItems[index],
          creationDate: null,
          dueDate: null,
          completionDate: null,
        });
      });

      await batch.commit();

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
