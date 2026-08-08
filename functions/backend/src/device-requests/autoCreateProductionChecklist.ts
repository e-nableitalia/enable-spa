import type { CallableRequest } from "firebase-functions/v2/https";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { createDeviceRequestChecklist } from "./createDeviceRequestChecklist";
import { PRODUCTION_CHECKLIST_ITEMS, PRODUCTION_CHECKLIST_TITLE } from "./productionChecklistItems";

/**
 * Status introdotto da EA-148 (collasso delle 5 ex-fasi granulari di
 * fabbricazione in un unico valore) verso cui questa Story auto-istanzia la
 * checklist di produzione.
 */
const PRODUCTION_STATUS = "in produzione";

/**
 * Auto-istanziazione della checklist di produzione alla transizione di una
 * `deviceRequest` verso lo status `in produzione` (EA-151).
 *
 * Riusa `createDeviceRequestChecklist` (stesso RBAC admin/volontario
 * assegnato, stesso vincolo `MAX_CHECKLISTS_PER_REQUEST`, stesso collegamento
 * via `checklistIds`) passandogli i 5 item fissi corrispondenti alle ex-fasi
 * granulari collassate, invece di lasciare che risolva un template.
 *
 * Idempotenza (Scenario 2 EA-151 — nessuna checklist duplicata su
 * transizioni successive, es. dopo standby, NÉ su transizioni concorrenti
 * verso "in produzione" sulla stessa richiesta): poiché per decisione
 * esplicita del supervisor nessun marcatore identifica quale tra le
 * checklist collegate rappresenti la produzione, l'idempotenza è tracciata
 * da un flag dedicato e indipendente,
 * `deviceRequests/{id}.productionChecklistCreated`. Il flag non referenzia
 * alcun checklistId: non introduce quindi il marcatore "quale checklist è
 * quella di produzione" esplicitamente escluso dallo scope della Story,
 * resta solo un guard "l'auto-creazione è già avvenuta".
 *
 * Lettura e claim del flag avvengono in un'unica transazione Firestore,
 * PRIMA di creare la checklist (non dopo, come una prima versione di questa
 * funzione faceva): solo l'invocazione che vince il compare-and-swap
 * procede alla creazione, le altre (es. due `changeStatus` quasi simultanei
 * sulla stessa richiesta) vedono il flag già `true` e restituiscono
 * immediatamente. Se la creazione fallisce dopo aver vinto il claim, il
 * flag viene rimosso (rollback) per non bloccare permanentemente un futuro
 * retry — vedi gestione errori sotto.
 *
 * Nessun gate: per decisione esplicita del supervisor la checklist resta
 * uno strumento di tracciamento scorrelato da qualunque transizione di
 * status. Un fallimento nell'auto-creazione (es. richiesta già al limite
 * `MAX_CHECKLISTS_PER_REQUEST`) viene quindi solo loggato, senza propagare
 * l'errore al chiamante (`device/changeStatus.ts`): la transizione di stato
 * resta valida anche se la checklist non può essere creata, e — grazie al
 * rollback del claim — un successivo tentativo può ancora riuscire.
 */
export async function autoCreateProductionChecklistOnTransition(
  request: CallableRequest,
  params: { requestId: string; newStatus: string }
): Promise<void> {
  const { requestId, newStatus } = params;

  if (newStatus !== PRODUCTION_STATUS) {
    return;
  }

  const db = getFirestore();
  const requestRef = db.collection("deviceRequests").doc(requestId);

  const claimed = await db.runTransaction(async (tx) => {
    const snap = await tx.get(requestRef);
    if (Boolean(snap.data()?.productionChecklistCreated)) {
      return false;
    }
    tx.update(requestRef, {
      productionChecklistCreated: true,
      updatedAt: FieldValue.serverTimestamp(),
    });
    return true;
  });

  if (!claimed) {
    return;
  }

  try {
    console.log(
      `[autoCreateProductionChecklist] Auto-creating production checklist for request ${requestId}`
    );

    await createDeviceRequestChecklist.run({
      ...request,
      data: {
        requestId,
        title: PRODUCTION_CHECKLIST_TITLE,
        items: PRODUCTION_CHECKLIST_ITEMS,
      },
    } as CallableRequest);

    console.log(
      `[autoCreateProductionChecklist] OK: production checklist created for request ${requestId}`
    );
  } catch (error) {
    console.error(
      `[autoCreateProductionChecklist] KO: could not auto-create production checklist for request ${requestId}`,
      error
    );
    await requestRef.update({ productionChecklistCreated: FieldValue.delete() }).catch((rollbackError) => {
      console.error(
        `[autoCreateProductionChecklist] KO: rollback of productionChecklistCreated failed for request ${requestId}`,
        rollbackError
      );
    });
  }
}
