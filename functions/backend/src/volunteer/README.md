# volunteer

Modulo backend del dominio volunteer-management: gestisce consensi, profilo,
stampanti, invito, attivazione/disattivazione e ruolo dei volontari (documento
`users/{uid}` in Firestore), più la vista amministrativa sui volontari.

## Callable

Tutte definite come `onCall` (region `europe-west1`) e richiedono un utente
autenticato (`unauthenticated` altrimenti). Il ruolo è letto dal campo `role`
del documento `users/{uid}` del chiamante (`permission-denied` se non ammesso):

- `acceptVolunteerConsents` (`acceptVolunteerConsents.ts:7`) — solo utente autenticato, nessun controllo di ruolo.
- `addPrinter` (`addPrinter.ts:38`) — solo `role=volunteer` (`addPrinter.ts:45`).
- `inviteVolunteer` (`invite.ts:31`) — solo `role=admin` (`invite.ts:39`).
- `listVolunteerAdminData` (`listVolunteerAdminData.ts:98`) — solo `role=admin` (`listVolunteerAdminData.ts:107`).
- `setUserRole` (`setUserRole.ts:11`) — solo `role=admin`; ruoli ammessi `volunteer`/`admin`; un admin non può cambiare il proprio ruolo (`setUserRole.ts:25-38`).
- `updateVolunteerProfile` (`updateVolunteerProfile.ts:23`) — `role=volunteer` o `role=admin` (`updateVolunteerProfile.ts:37`).
- `activateVolunteers` (`volunteerState.ts:22`) — solo `role=admin` (`volunteerState.ts:29`).
- `deactivateVolunteers` (`volunteerState.ts:124`) — solo `role=admin` (`volunteerState.ts:131`).

## Test

```bash
cd functions/backend && npm test
```

Lo script `test` di `functions/backend/package.json` lancia `jest`.
