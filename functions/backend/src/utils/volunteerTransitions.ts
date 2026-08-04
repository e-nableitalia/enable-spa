import { HttpsError } from "firebase-functions/v2/https";

/**
 * Le 5 transizioni di stato che un volontario assegnato può eseguire su una
 * deviceRequest. Contratto RBAC invariato rispetto alla versione inline
 * precedentemente in device/changeStatus.ts.
 */
export function isAllowedVolunteerTransition(from: string, to: string): boolean {
  return (
    (from === "scelta device e dimensionamento" && to === "personalizzazione") ||
    (from === "personalizzazione" && to === "attesa materiali") ||
    (from === "attesa materiali" && to === "fabbricazione") ||
    (from === "fabbricazione" && to === "pronta per spedizione") ||
    (from === "pronta per spedizione" && to === "spedita")
  );
}

/**
 * Applica il contratto RBAC di device-requests/dc-volunteer-transition:
 * - admin: qualsiasi transizione consentita, nessun controllo aggiuntivo;
 * - volunteer: deve essere in assignedVolunteers e la transizione deve
 *   rientrare tra le 5 codificate in isAllowedVolunteerTransition;
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
