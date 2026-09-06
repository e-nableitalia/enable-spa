/**
 * Dominio a 11 valori di `deviceRequests.status`, dopo la riduzione EA-148
 * (decisione opt-b di `ss-device-request-macro-status`). Specchio backend
 * di `enable-device/src/helpers/requestStatus.ts::REQUEST_STATUSES`, non
 * importabile direttamente da `functions/backend` (pacchetto separato).
 *
 * Usato da `changeStatus.ts` per rifiutare un `newStatus` fuori dominio
 * (F-29, residuo): prima di questa validazione un admin poteva scrivere
 * qualunque stringa, inclusi i 10 valori rimossi, chiamando la Cloud
 * Function direttamente invece che tramite il dropdown UI.
 */
export const REQUEST_STATUSES = [
  "inviata",
  "validata",
  "da gestire",
  "attesa volontario",
  "in produzione",
  "pronta per spedizione",
  "spedita",
  "followup famiglia",
  "completata",
  "annullata",
  "standby",
] as const;

export type RequestStatus = typeof REQUEST_STATUSES[number];

export function isValidRequestStatus(value: unknown): value is RequestStatus {
  return typeof value === "string" &&
    (REQUEST_STATUSES as readonly string[]).includes(value);
}
