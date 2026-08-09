import { HttpsError } from "firebase-functions/v2/https";

/**
 * Le 2 transizioni di stato che un volontario assegnato può eseguire su una
 * deviceRequest. Ridotte dalle precedenti 5 coppie dalla Story EA-148
 * (decisione opt-b di ss-device-request-macro-status, 2026-08-06): i 5 stati
 * di produzione pre-spedizione collassano nell'unico valore `in produzione`,
 * lasciando solo le due transizioni verso spedizione.
 */
export function isAllowedVolunteerTransition(from: string, to: string): boolean {
  return (
    (from === "in produzione" && to === "pronta per spedizione") ||
    (from === "pronta per spedizione" && to === "spedita")
  );
}

/**
 * Applica il contratto RBAC di device-requests/dc-volunteer-transition:
 * - admin: qualsiasi transizione consentita, nessun controllo aggiuntivo;
 * - volunteer: deve essere in assignedVolunteers e la transizione deve
 *   rientrare tra le 2 codificate in isAllowedVolunteerTransition;
 * - qualsiasi altro ruolo: rifiutato.
 *
 * Lancia HttpsError permission-denied con gli stessi messaggi del
 * comportamento pre-refactoring.
 */
export function assertVolunteerTransitionAllowed(
  role: string | undefined,
  uid: string,
  assignedVolunteers: string[] | undefined,
  currentStatus: string,
  newStatus: string
): void {
  if (role === "admin") {
    return;
  }

  if (role === "volunteer") {
    if (!assignedVolunteers?.includes(uid)) {
      throw new HttpsError("permission-denied", "Not assigned volunteer");
    }

    if (!isAllowedVolunteerTransition(currentStatus, newStatus)) {
      throw new HttpsError("permission-denied", "Invalid status transition");
    }

    return;
  }

  throw new HttpsError("permission-denied", "Invalid role");
}
