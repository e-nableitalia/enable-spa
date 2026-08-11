import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore } from "firebase-admin/firestore";
import { getInvokeId } from "../utils/invoke";
import { logSecurityEvent } from "../security/securityLog";
import { isChecklistItemComplete, ChecklistItemLike } from "../organizer/checklistCompleteness";
import { resolveChecklistItems } from "../organizer/resolveChecklistItems";

const REGION = "europe-west1";

interface ShareChecklistItemLike extends ChecklistItemLike {
  title?: string;
}

/**
 * Cloud Function callable pubblica (nessuna autenticazione Firebase, sul
 * modello di `device/createDeviceRequest.ts`): risolve un token di
 * condivisione (`checklistShareLinks/{token}`) e restituisce
 * esclusivamente l'avanzamento macro/percentuale di completamento della
 * checklist collegata (Story EA-113).
 *
 * Confine esplicito (device-requests/dc-private-data-separation): la
 * risposta NON include item, assegnatari, note o altro dettaglio interno
 * — solo `percentComplete`. Il token non scade e non e' revocabile
 * (decisione confermata in refinement EA-108, 2026-07-09): nessun
 * controllo di scadenza va introdotto qui.
 *
 * `checklists/{id}.items` e' un array di soli `itemId` da EA-137 (Epic
 * EA-134): risolve i documenti reali via `resolveChecklistItems` (stesso
 * modulo condiviso gia' usato da `getChecklist`/`getChecklistCompleteness`)
 * prima di applicare il gate di completezza — leggere `items` direttamente
 * come se contenesse oggetti item completi calcolava silenziosamente un
 * `percentComplete` sempre errato (F-24, mai corretto qui da EA-138).
 *
 * Oltre a `percentComplete`, la risposta include ora anche `items`
 * (richiesto dall'operatore): un elenco semplificato, un oggetto per
 * item con solo `title` e un flag booleano `completed`, MAI assegnatario,
 * note, quantita' o lo `status` grezzo. Il flag e' calcolato con lo
 * stesso gate type-aware condiviso (`isChecklistItemComplete`), cosi' da
 * presentare in modo omogeneo i tre type (`boolean`/`numeric`/`generic`)
 * su questa pagina pubblica, senza esporre la colonna Quantita' (rilevante
 * solo per `numeric`, fonte di confusione se mostrata per gli altri type).
 */
export const getChecklistShareStatus = onCall(
  { region: REGION },
  async (request) => {
    const invokeId = getInvokeId(request);
    console.log(`[getChecklistShareStatus] Invoke ID: ${invokeId} - Function called`);
    const ip = request.rawRequest?.ip ?? "unknown";

    try {
      const { token } = request.data as { token?: string };
      if (!token || typeof token !== "string") {
        throw new HttpsError("invalid-argument", "Missing parameter: token");
      }

      const db = getFirestore();
      const linkSnap = await db.collection("checklistShareLinks").doc(token).get();
      if (!linkSnap.exists) {
        throw new HttpsError("not-found", "Share link not found");
      }

      const checklistId = linkSnap.data()?.checklistId;
      if (!checklistId || typeof checklistId !== "string") {
        throw new HttpsError("not-found", "Share link not found");
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
        action: "get_checklist_share_status",
        outcome: "success",
        severity: "low",
        actor: { ip },
        context: { function: "getChecklistShareStatus", invokeId },
      });

      console.log(`[getChecklistShareStatus] OK: token ${token} percentComplete=${percentComplete}`);
      return { percentComplete, items: itemsSummary };
    } catch (error) {
      console.error("[getChecklistShareStatus] KO:", error);
      await logSecurityEvent({
        type: "system",
        action: "get_checklist_share_status_failed",
        outcome: "failure",
        severity: "medium",
        actor: { ip },
        context: { function: "getChecklistShareStatus", invokeId },
      });
      if (error instanceof HttpsError) throw error;
      throw new HttpsError("internal", "Internal Server Error");
    }
  }
);
