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
 * transizioni successive, es. dopo standby): poiché per decisione esplicita
 * del supervisor nessun marcatore identifica quale tra le checklist
 * collegate rappresenti la produzione, l'idempotenza è tracciata da un
 * flag dedicato e indipendente, `deviceRequests/{id}.productionChecklistCreated`,
 * valorizzato a `true` solo dopo la prima auto-creazione riuscita. Il flag
 * non referenzia alcun checklistId: non introduce quindi il marcatore
 * "quale checklist è quella di produzione" esplicitamente escluso dallo
 * scope della Story, resta solo un guard "l'auto-creazione è già avvenuta".
 *
 * Nessun gate: per decisione esplicita del supervisor la checklist resta
 * uno strumento di tracciamento scorrelato da qualunque transizione di
 * status. Un fallimento nell'auto-creazione (es. richiesta già al limite
 * `MAX_CHECKLISTS_PER_REQUEST`) viene quindi solo loggato, senza propagare
 * l'errore al chiamante (`device/changeStatus.ts`): la transizione di stato
 * resta valida anche se la checklist non può essere creata.
 */
export async function autoCreateProductionChecklistOnTransition(
  request: CallableRequest,
  params: { requestId: string; newStatus: string; productionChecklistAlreadyCreated: boolean }
): Promise<void> {
  const { requestId, newStatus, productionChecklistAlreadyCreated } = params;

  if (newStatus !== PRODUCTION_STATUS || productionChecklistAlreadyCreated) {
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

    await getFirestore().collection("deviceRequests").doc(requestId).update({
      productionChecklistCreated: true,
      updatedAt: FieldValue.serverTimestamp(),
    });

    console.log(
      `[autoCreateProductionChecklist] OK: production checklist created for request ${requestId}`
    );
  } catch (error) {
    console.error(
      `[autoCreateProductionChecklist] KO: could not auto-create production checklist for request ${requestId}`,
      error
    );
  }
}
