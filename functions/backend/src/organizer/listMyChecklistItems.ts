import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { logSecurityEvent } from "../security/securityLog";
import { getInvokeId } from "../utils/invoke";
import { ChecklistItemLike } from "./checklistCompleteness";

const REGION = "europe-west1";

/** Firestore `array-contains-any` accetta al massimo 30 valori. */
const ARRAY_CONTAINS_ANY_MAX = 30;

interface ChecklistItemDoc extends ChecklistItemLike {
  id: string;
  checklistId: string;
}

interface ChecklistOrigin {
  type: string;
  id: string;
}

function isOrigin(value: unknown): value is ChecklistOrigin {
  if (!value || typeof value !== "object") return false;
  const candidate = value as { type?: unknown; id?: unknown };
  return typeof candidate.type === "string" && typeof candidate.id === "string" && candidate.id.length > 0;
}

/**
 * Per checklist senza `origin` sul documento (dati legacy pre-EA origin, o
 * create path che non lo scriveva), ricostruisce la provenienza cercando
 * `deviceRequests` / `projects` che referenziano il checklistId in
 * `checklistIds`. Opzionalmente riscrive `origin` sulla checklist (heal)
 * così le letture successive non ripetono il reverse-lookup.
 */
async function resolveMissingOrigins(
  db: Firestore,
  originByChecklistId: Map<string, ChecklistOrigin | null>
): Promise<void> {
  const orphanIds = Array.from(originByChecklistId.entries())
    .filter(([, origin]) => origin === null)
    .map(([checklistId]) => checklistId);

  if (orphanIds.length === 0) return;

  const remaining = new Set(orphanIds);

  async function scanCollection(collectionName: "deviceRequests" | "projects", originType: string) {
    for (let i = 0; i < orphanIds.length && remaining.size > 0; i += ARRAY_CONTAINS_ANY_MAX) {
      const chunk = orphanIds.slice(i, i + ARRAY_CONTAINS_ANY_MAX).filter((id) => remaining.has(id));
      if (chunk.length === 0) continue;

      const snap = await db.collection(collectionName).where("checklistIds", "array-contains-any", chunk).get();
      for (const docSnap of snap.docs) {
        const checklistIds: unknown[] = Array.isArray(docSnap.data()?.checklistIds)
          ? docSnap.data()!.checklistIds
          : [];
        for (const checklistId of checklistIds) {
          if (typeof checklistId !== "string" || !remaining.has(checklistId)) continue;
          const origin: ChecklistOrigin = { type: originType, id: docSnap.id };
          originByChecklistId.set(checklistId, origin);
          remaining.delete(checklistId);
          // Heal best-effort: non blocca la risposta se la scrittura fallisce.
          db.collection("checklists")
            .doc(checklistId)
            .update({ origin })
            .catch((err) => {
              console.warn(
                `[listMyChecklistItems] Failed to heal origin on checklist ${checklistId}:`,
                err
              );
            });
        }
      }
    }
  }

  await scanCollection("deviceRequests", "deviceRequest");
  if (remaining.size > 0) {
    await scanCollection("projects", "project");
  }
}

/**
 * listMyChecklistItems: aggregazione cross-checklist self-only (Epic
 * EA-134, studio deciso ss-user-todo-list/opt-e).
 *
 * Prima eccezione esplicita nel core Organizer al confine consolidato
 * "core senza RBAC oltre l'autenticazione": la query è sempre forzata
 * sull'uid del chiamante autenticato, salvo un chiamante con ruolo admin
 * che passi esplicitamente un `uid` diverso dal proprio.
 *
 * Query diretta e a campo singolo (più un secondo filtro opzionale) sulla
 * collection di primo livello `checklistItems` (EA-137): `where('assignee',
 * '==', uid)`, con `where('category', '==', scope)` aggiuntivo quando
 * `scope` è fornito (risoluzione F-23/EA-136: `scope` corrisponde a
 * `category`, già denormalizzata su ogni `checklistItems`). Nessun
 * post-filtro applicativo per `scope`.
 *
 * Risolve `origin` delle rispettive checklist padre per OGNI item (non solo
 * quelli pending) con un'unica lettura batch (`db.getAll`) sui `checklistId`
 * distinti referenziati: il consumer frontend (pagina "I miei item",
 * gestione in blocco di tutti gli item assegnati) ne ha bisogno anche per
 * gli item già completati, per poter risolvere il `requestId` necessario a
 * `updateDeviceRequestChecklistItem` se l'utente vuole comunque modificarli
 * (riaprirli, correggere una nota, ecc.), non solo per il contesto di
 * provenienza mostrato in sola lettura.
 *
 * Se la checklist padre ha `origin` assente (legacy), tenta un
 * reverse-lookup su `deviceRequests`/`projects.checklistIds` e, se trova
 * un match, lo espone nella risposta e lo riscrive sulla checklist (heal).
 */
export const listMyChecklistItems = onCall(
  { region: REGION },
  async (request) => {
    const invokeId = getInvokeId(request);
    console.log(`[listMyChecklistItems] Invoke ID: ${invokeId} - Function called`);
    try {
      const callerUid = request.auth?.uid;
      if (!callerUid) {
        throw new HttpsError("unauthenticated", "User must be authenticated");
      }

      const { uid, scope } = request.data as { uid?: string; scope?: string };
      if (uid !== undefined && (typeof uid !== "string" || !uid.trim())) {
        throw new HttpsError("invalid-argument", "uid must be a non-empty string");
      }
      if (scope !== undefined && (typeof scope !== "string" || !scope.trim())) {
        throw new HttpsError("invalid-argument", "scope must be a non-empty string");
      }

      const db = getFirestore();

      let targetUid = callerUid;
      if (uid !== undefined && uid !== callerUid) {
        const callerSnap = await db.collection("users").doc(callerUid).get();
        if (!callerSnap.exists || callerSnap.data()?.role !== "admin") {
          console.log(`[listMyChecklistItems] KO: Permission denied for uid ${callerUid} querying ${uid}`);
          throw new HttpsError("permission-denied", "Only admin can query another user's checklist items");
        }
        targetUid = uid;
      }

      let query: FirebaseFirestore.Query = db.collection("checklistItems").where("assignee", "==", targetUid);
      if (scope !== undefined) {
        query = query.where("category", "==", scope);
      }

      const snap = await query.get();
      const items = snap.docs.map((doc) => doc.data() as unknown as ChecklistItemDoc);

      const referencedChecklistIds = Array.from(new Set(items.map((item) => item.checklistId)));

      const originByChecklistId = new Map<string, ChecklistOrigin | null>();
      if (referencedChecklistIds.length > 0) {
        const checklistRefs = referencedChecklistIds.map((checklistId) => db.collection("checklists").doc(checklistId));
        const checklistSnaps = await db.getAll(...checklistRefs);
        checklistSnaps.forEach((checklistSnap) => {
          if (checklistSnap.exists) {
            const rawOrigin = checklistSnap.data()?.origin ?? null;
            originByChecklistId.set(checklistSnap.id, isOrigin(rawOrigin) ? rawOrigin : null);
          }
        });
        await resolveMissingOrigins(db, originByChecklistId);
      }

      const responseItems = items.map((item) => ({
        ...item,
        origin: originByChecklistId.get(item.checklistId) ?? null,
      }));

      await logSecurityEvent({
        type: "system",
        action: "list_my_checklist_items",
        outcome: "success",
        severity: "low",
        actor: { uid: callerUid, email: request.auth?.token?.email ?? undefined },
        context: { function: "listMyChecklistItems", invokeId, requestId: targetUid },
      });

      console.log(`[listMyChecklistItems] OK: ${responseItems.length} item(s) found for uid ${targetUid}`);
      return { items: responseItems };
    } catch (error) {
      console.error("[listMyChecklistItems] KO:", error);
      await logSecurityEvent({
        type: "system",
        action: "list_my_checklist_items_failed",
        outcome: "failure",
        severity: "high",
        actor: { uid: request.auth?.uid, email: request.auth?.token?.email ?? undefined },
        context: { function: "listMyChecklistItems", invokeId },
      });
      if (error instanceof HttpsError) throw error;
      throw new HttpsError("internal", "Internal Server Error");
    }
  }
);
