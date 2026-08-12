import { HttpsError } from "firebase-functions/v2/https";
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
 * Codici `HttpsError` che `createDeviceRequestChecklist.ts` può lanciare
 * SOLO nelle proprie validazioni iniziali (auth/RBAC/argomenti/limite
 * `MAX_CHECKLISTS_PER_REQUEST`), tutte eseguite PRIMA di qualunque
 * scrittura Firestore — vedi righe 64-130 di quel file, tutte precedenti al
 * primo `createChecklist.run`. Un errore con uno di questi codici garantisce
 * che nessuna checklist sia stata creata: sicuro da usare come condizione
 * per il rollback del guard (vedi commento sul catch sotto). Qualunque
 * altro errore (rete, timeout, o il write separato e non atomico di
 * `requestRef.update` alla riga 198 di quel file, che collega la checklist
 * già scritta a `checklistIds`) NON dà questa garanzia e non deve fare
 * rollback.
 */
const SAFE_TO_ROLLBACK_ERROR_CODES = new Set([
  "unauthenticated",
  "invalid-argument",
  "not-found",
  "failed-precondition",
  "permission-denied",
]);

function isSafeToRollback(error: unknown): boolean {
  return error instanceof HttpsError && SAFE_TO_ROLLBACK_ERROR_CODES.has(error.code);
}

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
 * immediatamente.
 *
 * Rollback del claim SOLO per errori pre-scrittura (vedi
 * `isSafeToRollback`/`SAFE_TO_ROLLBACK_ERROR_CODES` sopra): una prima
 * versione di questa funzione faceva rollback incondizionato su qualunque
 * errore, ma `createDeviceRequestChecklist.ts` esegue la propria scrittura
 * in due passi non atomici (creazione della checklist via `createChecklist`,
 * poi un `requestRef.update` separato per collegarla a `checklistIds`) — un
 * errore nel secondo passo lascia una checklist già scritta ma orfana, e un
 * rollback incondizionato in quel caso avrebbe riabilitato un successivo
 * tentativo a crearne una SECONDA, violando esattamente la garanzia "nessun
 * duplicato" di questa funzione (adversarial concern, panel review EA-151).
 * Per gli errori che sappiamo con certezza pre-scrittura (es. richiesta già
 * al limite `MAX_CHECKLISTS_PER_REQUEST`) il rollback resta invece
 * legittimo e necessario, per non bloccare permanentemente un retry che
 * potrebbe riuscire in futuro (es. dopo che l'admin ha rimosso una
 * checklist in eccesso).
 *
 * Nessun gate: per decisione esplicita del supervisor la checklist resta
 * uno strumento di tracciamento scorrelato da qualunque transizione di
 * status. Un fallimento — inclusa la stessa transazione di claim del
 * guard, non solo la creazione della checklist che segue (una prima
 * versione di questa funzione avvolgeva in try/catch solo quest'ultima:
 * un errore della transazione di claim, es. `ABORTED` per contention su
 * `changeStatus` quasi simultanei — esattamente lo scenario che questa
 * funzione gestisce — si propagava non gestito fino al chiamante,
 * facendo fallire l'intera callable pur con la transizione di stato già
 * committata; adversarial concern, panel review EA-151) — viene quindi
 * solo loggato, senza propagare l'errore al chiamante
 * (`device/changeStatus.ts`): la transizione di stato resta valida anche
 * se la checklist non può essere creata o il suo guard non può essere
 * reclamato.
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

  // `claimed` resta `false` se l'eccezione arriva dalla transazione stessa
  // (nessuna scrittura avvenuta, il catch sotto non deve fare nulla) e
  // diventa `true` solo dopo che la transazione ha effettivamente commesso
  // il claim — distingue le due sorgenti d'errore nel catch comune.
  let claimed = false;

  try {
    claimed = await db.runTransaction(async (tx) => {
      const snap = await tx.get(requestRef);
      if (snap.data()?.productionChecklistCreated) {
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

    if (!claimed) {
      // Fallita la transazione di claim stessa (es. contention): nessuna
      // scrittura e' avvenuta, niente da rollbackare.
      return;
    }

    if (!isSafeToRollback(error)) {
      console.warn(
        `[autoCreateProductionChecklist] guard NOT rolled back for request ${requestId}: ` +
          "the error is not provably pre-write, a partial write (checklist created but not yet " +
          "linked to checklistIds) cannot be ruled out — rolling back here could enable a duplicate " +
          "checklist on a future retry."
      );
      return;
    }

    await requestRef.update({ productionChecklistCreated: FieldValue.delete() }).catch((rollbackError) => {
      console.error(
        `[autoCreateProductionChecklist] KO: rollback of productionChecklistCreated failed for request ${requestId}`,
        rollbackError
      );
    });
  }
}
