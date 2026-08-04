/**
 * Perimetro degli 8 stati granulari di "fabbricazione" di una deviceRequest.
 *
 * Modulo condiviso, senza dipendenze da Firestore o da Cloud Functions.
 * Prima di questa centralizzazione (EA-107) la lista degli 8 stati era
 * duplicata in `mapToPublicStatus`. Le 5 transizioni volontario consentite
 * tra questi stati (contratto device-requests/dc-volunteer-transition) sono
 * gestite separatamente da `utils/volunteerTransitions.ts` (estratte da
 * EA-103), non duplicate qui.
 *
 * Nessuno stato viene rimosso e nessuna transizione cambia in questa Story:
 * è una pura estrazione della fonte di verità già esistente. La rimozione
 * dei sub-stati granulari a favore della delega all'Organizer è fuori
 * scope finché EA-108 non sarà approvata e collegata.
 */

export const PRODUCTION_LIFECYCLE_STATUSES = [
  "scelta device e dimensionamento",
  "personalizzazione",
  "attesa materiali",
  "fabbricazione",
  "fitting",
  "pronta per spedizione",
  "spedita",
  "followup famiglia",
] as const;

export type ProductionLifecycleStatus = typeof PRODUCTION_LIFECYCLE_STATUSES[number];

export function isProductionLifecycleStatus(value: unknown): value is ProductionLifecycleStatus {
  return typeof value === "string" &&
    (PRODUCTION_LIFECYCLE_STATUSES as readonly string[]).includes(value);
}
