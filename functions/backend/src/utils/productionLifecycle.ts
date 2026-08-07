/**
 * Perimetro dei 4 stati granulari di "fabbricazione" di una deviceRequest.
 *
 * Modulo condiviso, senza dipendenze da Firestore o da Cloud Functions.
 *
 * Story EA-148 (decisione opt-b di ss-device-request-macro-status,
 * 2026-08-06): i 5 stati di produzione pre-spedizione precedentemente
 * distinti (`scelta device e dimensionamento`, `personalizzazione`,
 * `attesa materiali`, `fabbricazione`, `fitting`) collassano nell'unico
 * valore `in produzione`. Le 2 transizioni volontario consentite tra questi
 * stati (contratto device-requests/dc-volunteer-transition, ridotte dalle
 * precedenti 5 coppie) sono gestite separatamente da
 * `utils/volunteerTransitions.ts`, non duplicate qui.
 */

export const PRODUCTION_LIFECYCLE_STATUSES = [
  "in produzione",
  "pronta per spedizione",
  "spedita",
  "followup famiglia",
] as const;

export type ProductionLifecycleStatus = typeof PRODUCTION_LIFECYCLE_STATUSES[number];

export function isProductionLifecycleStatus(value: unknown): value is ProductionLifecycleStatus {
  return typeof value === "string" &&
    (PRODUCTION_LIFECYCLE_STATUSES as readonly string[]).includes(value);
}
