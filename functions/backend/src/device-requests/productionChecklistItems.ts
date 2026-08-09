import { ChecklistItemType } from "../organizer/checklistItemStatus";

/**
 * I 5 item con cui viene seminata la checklist di produzione auto-istanziata
 * alla transizione di una `deviceRequest` verso lo status `in produzione`
 * (Story EA-151). Corrispondono uno a uno alle ex-fasi granulari collassate
 * in quell'unico status da EA-148 (`utils/productionLifecycle.ts`):
 * `scelta device e dimensionamento`, `personalizzazione`,
 * `attesa materiali`, `fabbricazione`, `fitting`.
 *
 * `type: "generic"` per tutti: sono item di tracciamento fase, non booleani
 * né numerici, stesso default già usato altrove per item senza un type più
 * specifico (`getDeviceRequestChecklistCompleteness.ts`, F-8).
 */
export const PRODUCTION_CHECKLIST_TITLE = "Checklist di produzione";

export const PRODUCTION_CHECKLIST_ITEMS: { title: string; type: ChecklistItemType }[] = [
  { title: "Scelta device e dimensionamento", type: "generic" },
  { title: "Personalizzazione", type: "generic" },
  { title: "Attesa materiali", type: "generic" },
  { title: "Fabbricazione", type: "generic" },
  { title: "Fitting", type: "generic" },
];
