# Story: Super Admin — deploy template email e backup Firestore

## Stato attuale

L'Epic EA-171 (Pipeline Stage: Approved) stabilisce il perimetro: un flag
RBAC additivo `superAdmin`, e due capability operative gated da quel
flag — deploy dei template email versionati (prima implementazione reale
di `ir-email-templates-versioned`, chiude anche F-38) e backup on-demand
di Firestore. Il contenitore UI (`AdminMaintenanceRequests.tsx`, route
`/admin/requests/maintenance`) è già stato svuotato dalle sue funzioni
one-shot completate sul branch `super-admin-maintenance-cleanup`
(commit `52c21a6`), non ancora mergiato: questa Story parte da quel
branch, non da `develop`.

## RBAC: flag `superAdmin`

- `users/{uid}.superAdmin: boolean`, additivo a `role: "admin"` esistente
  — nessun controllo `role === "admin"` esistente viene toccato.
- Bootstrap solo manuale in console Firestore: nessuna Cloud Function di
  questa Story legge o scrive questo flag per conto di altri utenti,
  nessuna UI di self-service.
- Nuovo helper condiviso `functions/backend/src/security/superAdmin.ts`:
  `requireSuperAdmin(db, uid): Promise<void>` — throw `permission-denied`
  se `users/{uid}.superAdmin !== true`. Stesso stile di
  `functions/backend/src/utils/roles.ts` (`requireAdminRole`).

## Capability 1: deploy template email versionati

- **Registro in codice** (`functions/backend/src/emailTemplates/registry.ts`):
  union type `EmailTemplateId` con i 5 id noti
  (`attivazioneVolontario`, `confermaRicezione`, `inviteVolunteer`,
  `shipmentRequest`, `deviceRequestDocumentsTransmission`), più una mappa
  `EMAIL_TEMPLATES: Record<EmailTemplateId, {subject: string; html: string; text?: string}>`
  col contenuto versionato di ciascun template (schema nativo
  dell'estensione Trigger Email).
- **Migrazione dei 5 sender esistenti** a importare l'id dal registro
  invece di una stringa libera, senza cambiare il nome effettivo del
  template risolto (comportamento runtime identico):
  `volunteer/volunteerState.ts` (`activateVolunteers`),
  `device/createDeviceRequest.ts`, `volunteer/invite.ts`,
  `shipments/shipmentRequests.ts`, `device-requests/sendDocumentsEmail.ts`.
- **Materializzazione una tantum**: contenuto reale dei 4 template
  esistenti letto da produzione (`enableitalia`, sola lettura, fuori da
  questa Story — eseguita dall'agente supervisor direttamente, non una
  Cloud Function) e trascritto nel registro. Il quinto template
  (`deviceRequestDocumentsTransmission`, F-38, oggi mancante sul progetto
  live) viene scritto ex novo nello stesso registro.
- **Cloud Function `deployEmailTemplates`**: superadmin-gated
  (`requireSuperAdmin`), forward-only (repo → Firestore, mai il
  contrario), scrive/aggiorna ogni documento `emailTemplates/{id}` del
  registro sul progetto su cui la funzione è deployata (nessuna scelta
  esplicita di ambiente: ogni deploy della funzione opera solo sul proprio
  progetto Firebase). `logSecurityEvent` su ogni invocazione.
- **UI**: pulsante "Deploy template email" nella pagina Super Admin
  (`AdminMaintenanceRequests.tsx`), con conferma esplicita prima
  dell'invocazione (azione che arriva a email reali) e riepilogo degli id
  aggiornati al termine.

## Capability 2: backup Firestore on-demand

- **Spike IAM** (precede la Cloud Function): verifica dei permessi minimi
  necessari perché il service account di runtime della Cloud Function
  possa invocare l'export nativo Firestore
  (`datastore.databases.export`) verso un bucket GCS dedicato — stesso
  principio del self-grant `serviceAccountTokenCreator` già verificato
  per la capability Allegati (EA-161). Decide inoltre: nome/regione del
  bucket di backup, policy di retention/lifecycle (proposta concreta da
  validare con l'operatore prima di costruire la Cloud Function
  definitiva).
- **Cloud Function `triggerFirestoreBackup`**: superadmin-gated
  (`requireSuperAdmin`), avvia l'export Firestore verso il bucket deciso
  dalla spike. `logSecurityEvent` su ogni invocazione (incluso l'esito).
- **UI**: pulsante "Backup Firestore" nella pagina Super Admin, con
  conferma esplicita e indicazione di dove trovare l'export completato
  (path GCS).

## Fuori scope

- Qualunque modifica al modello RBAC a due valori esistente
  (`role: "admin" | "volunteer"`) o ai controlli `role === "admin"` già
  presenti nel codice.
- UI di self-service per concedere/revocare `superAdmin`.
- Sync bidirezionale (Firestore → repo in continuo): solo la
  materializzazione una tantum descritta sopra.
- F-37 (doppio invio email in `activateVolunteers`): la materializzazione
  tocca il contenuto di `attivazioneVolontario` ma non decide quale dei
  due invii tenere — resta un difetto distinto, non affrontato qui.
- Restauro/ripristino da un backup Firestore: solo il trigger di export,
  nessun meccanismo di restore in questa Story.

## Source

- Epic: EA-171
- request_ref: requests/super-admin-epic-draft.md,
  docs/implementation-requests/email-templates-versioned-request.md

## Origine

Richiesta esplicita dell'operatore in conversazione, 2026-09-07:
implementazione diretta (no `plan-stories`/`run-epic`), un'unica Story per
tracciare il lavoro, verifica finale tramite `close-story --auto` — stesso
pattern già usato per EA-170.
