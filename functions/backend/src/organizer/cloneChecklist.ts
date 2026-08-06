import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { logSecurityEvent } from "../security/securityLog";
import { getInvokeId } from "../utils/invoke";
import { CHECKLIST_ITEM_STATUSES, ChecklistItemType, isChecklistItemType } from "./checklistItemStatus";
import { resolveChecklistItems } from "./resolveChecklistItems";

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
 * Clona un documento `checklistItems` risolto dell'istanza sorgente in un
 * nuovo item per la nuova istanza (EA-139: la sorgente da cui si copia non
 * è più un elemento dell'array embedded `checklists/{id}.items`, ma un
 * documento distinto in `checklistItems`, risolto da `resolveChecklistItems`
 * a valle di EA-137).
 *
 * Logica di clonazione invariata rispetto a prima di EA-137 (Epic EA-3,
 * riferimento `useWorkshopAsTemplate` nel mockup allegato; aggiornata da
 * EA-126): titolo, type e quantità vengono copiati dalla sorgente, mentre
 * stato, assegnatario, note e flag di completamento vengono sempre
 * azzerati, indipendentemente dallo stato di avanzamento che l'item aveva
 * nella sorgente — si riparte sempre da zero, ma senza perdere il type
 * dell'item.
 *
 * `type` è garantito valorizzato su ogni item di istanza a valle di EA-123
 * (`normalizeInitialItem` lo richiede e valida in creazione). Per le
 * istanze create prima di EA-123 (privi di `type` in Firestore), si applica
 * lo stesso default transitorio `"generic"` già usato altrove per dati
 * storici (vedi `docs/FINDINGS.md` F-8), invece di propagare un `undefined`
 * che romperebbe l'invariante "type sempre valorizzato" sulla nuova istanza.
 */
function cloneSourceItem(sourceItem: Record<string, unknown>): ClonedItemFields {
  const title = typeof sourceItem?.title === "string" ? sourceItem.title : "";
  const type: ChecklistItemType = isChecklistItemType(sourceItem?.type) ? sourceItem.type : "generic";
  const quantity = typeof sourceItem?.quantity === "number" ? sourceItem.quantity : null;

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
 * Cloud Function callable per la clonazione di una nuova checklist a
 * partire da un'istanza di checklist già esistente, nel core Organizer.
 *
 * Distinta dall'istanziazione da template (`createChecklistFromTemplate`):
 * qui si parte da un'istanza reale, in qualsiasi stato di avanzamento
 * (anche completata), non da un catalogo di riferimento. Caso d'uso
 * tipico: "ripeti questa checklist per una nuova occasione, ripartendo da
 * zero".
 *
 * Riceve dal consumer:
 * - `sourceChecklistId`: identificatore della checklist sorgente da cui
 *   clonare.
 * - `title`: titolo della nuova istanza di checklist.
 * - `category` (opzionale): identificatore di categoria opaco con cui
 *   sovrascrivere quello della sorgente. Se omesso, la categoria è
 *   ereditata dalla sorgente.
 *
 * Risolve gli item della sorgente (referenziati come `itemId` in
 * `checklists/{sourceChecklistId}.items`, EA-137) nei documenti reali
 * `checklistItems` e ne crea uno nuovo per ciascuno nella nuova istanza
 * (titolo, type e quantità copiati, stato impostato ad 'Assegnare',
 * assegnatario a null, flag di completamento a false e i tre campi
 * nullabili `creationDate`/`dueDate`/`completionDate` azzerati a null su
 * ciascun item clonato, indipendentemente dallo stato che avevano nella
 * sorgente), con `category` denormalizzata dalla nuova checklist (EA-139).
 * Registra `clonedFrom: <sourceChecklistId>` come riferimento storico, non
 * come dipendenza viva: la sorgente può essere modificata o eliminata in
 * seguito senza che la nuova istanza ne risenta.
 *
 * Crea un documento in `checklists/{checklistId}` — il cui campo `items` è
 * il solo elenco degli `itemId` generati — e un documento distinto in
 * `checklistItems/{itemId}` per ciascun item clonato. Restituisce il
 * `checklistId` generato al consumer.
 */
export const cloneChecklist = onCall(
  { region: REGION },
  async (request) => {
    const invokeId = getInvokeId(request);
    console.log(`[cloneChecklist] Invoke ID: ${invokeId} - Function called`);
    try {
      if (!request.auth) {
        console.log("[cloneChecklist] KO: Unauthenticated");
        throw new HttpsError("unauthenticated", "Authentication required");
      }
      const uid = request.auth.uid;

      const data = request.data ?? {};
      const { sourceChecklistId, title, category } = data;

      if (!sourceChecklistId || typeof sourceChecklistId !== "string") {
        console.log("[cloneChecklist] KO: Missing or invalid sourceChecklistId");
        throw new HttpsError("invalid-argument", "Missing or invalid sourceChecklistId");
      }

      if (!title || typeof title !== "string") {
        console.log("[cloneChecklist] KO: Missing or invalid title");
        throw new HttpsError("invalid-argument", "Missing or invalid title");
      }

      if (category !== undefined && category !== null && typeof category !== "string") {
        console.log("[cloneChecklist] KO: category must be a string");
        throw new HttpsError("invalid-argument", "category must be a string");
      }

      const db = getFirestore();
      const sourceRef = db.collection("checklists").doc(sourceChecklistId);
      const sourceSnap = await sourceRef.get();

      if (!sourceSnap.exists) {
        console.log(`[cloneChecklist] KO: source checklist ${sourceChecklistId} not found`);
        throw new HttpsError("not-found", "Source checklist not found");
      }

      const sourceData = sourceSnap.data() ?? {};
      const sourceItemIds: string[] = Array.isArray(sourceData.items) ? sourceData.items : [];
      const sourceItems = await resolveChecklistItems(db, sourceItemIds);
      const clonedItems: ClonedItemFields[] = sourceItems.map(cloneSourceItem);

      const resolvedCategory = (category as string | undefined) ?? sourceData.category;

      const checklistRef = db.collection("checklists").doc();
      const itemRefs = clonedItems.map(() => db.collection("checklistItems").doc());

      console.log(
        `[cloneChecklist] Creating checklist document ${checklistRef.id} cloned from ${sourceChecklistId}`
      );
      const batch = db.batch();
      batch.set(checklistRef, {
        category: resolvedCategory,
        title,
        items: itemRefs.map((itemRef) => itemRef.id),
        clonedFrom: sourceChecklistId,
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
        action: "clone_checklist",
        outcome: "success",
        severity: "low",
        actor: { uid, email: request.auth.token?.email ?? undefined },
        context: { function: "cloneChecklist", invokeId, requestId: checklistRef.id },
      });

      console.log(
        `[cloneChecklist] OK: checklist ${checklistRef.id} created cloned from ${sourceChecklistId}`
      );
      return { checklistId: checklistRef.id };
    } catch (error) {
      console.error("[cloneChecklist] KO:", error);
      await logSecurityEvent({
        type: "system",
        action: "clone_checklist_failed",
        outcome: "failure",
        severity: "high",
        actor: { uid: request.auth?.uid, email: request.auth?.token?.email ?? undefined },
        context: { function: "cloneChecklist", invokeId },
      });

      if (error instanceof HttpsError) {
        throw error;
      }

      throw new HttpsError("internal", "Internal Server Error");
    }
  }
);
