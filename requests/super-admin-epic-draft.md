# Epic Draft: Super Admin — deploy template email, backup Firestore

## Problem Statement

Oggi il RBAC dell'applicazione ha solo due ruoli (`role: "admin" | "volunteer"`
su `users/{uid}`), enforced identicamente in `setUserRole.ts` e in ogni
Cloud Function che richiede il ruolo admin. Esistono però capability
operative che richiedono un livello di fiducia superiore a "qualunque
admin", per rischio o sensibilità dell'azione: (1) deployare sul progetto
Firebase live il contenuto dei template email versionati nel repo — azione
che arriva direttamente a famiglie e volontari reali, già discussa e mai
implementata in `ir-email-templates-versioned` (draft dal 2026-08-12,
bloccata dal quinto template `device-request-documents-transmission`
tuttora mancante sul progetto live, F-38); (2) effettuare un backup
completo del database Firestore su Cloud Storage, oggi assente in
qualunque forma nel repo. Entrambe le esigenze sono concrete (non un
rafforzamento preventivo del modello RBAC), riportate esplicitamente
dall'operatore. `AdminMaintenanceRequests.tsx` (route
`/admin/requests/maintenance`, voce di menu già nascosta per
F-33/EA-152) è stata appena svuotata dalle sue funzioni one-shot
completate (import CSV, due migrazioni, "Delete All") proprio per
diventare il contenitore di queste due nuove capability, superadmin-gated.

## Opzione scelta

- Id: superadmin-flag-plus-two-capabilities
- Nome: Flag booleano `superAdmin` additivo su `users/{uid}`, due Cloud
  Function superadmin-gated (deploy template email, backup Firestore),
  consolidate nella pagina già svuotata `AdminMaintenanceRequests.tsx`.
- Summary: `users/{uid}.superAdmin: boolean`, mai esposto via
  `setUserRole.ts` (nessuna UI di self-service: bootstrap solo manuale in
  console Firestore, decisione esplicita dell'operatore per evitare un
  problema "chi controlla i controllori"). Un nuovo helper condiviso
  (`functions/backend/src/security/superAdmin.ts`,
  `requireSuperAdmin(db, uid)`) verifica il flag senza toccare nessun
  controllo `role === "admin"` esistente altrove nel codice — puramente
  additivo, zero rischio sulle Cloud Function già in produzione.
  Due capability, entrambe gated da questo helper:
  1. **Deploy template email** (prima vera implementazione di
     `ir-email-templates-versioned`): un registro in codice
     (`functions/backend/src/emailTemplates/registry.ts`, union type
     `EmailTemplateId` + mappa id→contenuto) sostituisce le stringhe
     libere nei 5 sender esistenti (`volunteerState.ts`,
     `createDeviceRequest.ts`, `invite.ts`, `shipmentRequests.ts`,
     `sendDocumentsEmail.ts`), risolvendo l'enforcement del mapping in
     modo verificabile a compile-time invece che con un documento
     descrittivo. I 4 template oggi live su produzione (`enableitalia`)
     vengono letti una tantum (sola lettura, nessuna scrittura) e
     materializzati come contenuto versionato nel registro; il quinto
     template (F-38) viene scritto ex novo nello stesso registro. Una
     Cloud Function superadmin-gated (`deployEmailTemplates`) applica poi
     il registro alla collection `emailTemplates` di qualunque progetto la
     esegua — forward-only, mai il contrario, come già deciso in
     `ir-email-templates-versioned` — con un trigger a bottone sulla
     pagina Super Admin.
  2. **Backup Firestore on-demand**: Cloud Function superadmin-gated
     (`triggerFirestoreBackup`) che usa l'API di export nativa di
     Firestore verso un bucket GCS dedicato, stesso genere di
     verifica IAM già condotta per la capability Allegati (self-grant
     `serviceAccountTokenCreator` o ruolo equivalente per l'export). Va
     preceduta da una spike IAM che confermi i permessi minimi necessari
     e decida bucket/lifecycle di retention (oggi non deciso). Trigger a
     bottone sulla stessa pagina Super Admin.

## Vincoli

- Il modello RBAC a due valori esistente (`role: "admin" | "volunteer"`)
  non viene toccato in nessun punto: `superAdmin` è un campo booleano
  aggiuntivo, verificato solo dalle due nuove Cloud Function di questa
  Epic, mai da un controllo `role === "admin"` preesistente.
- Nessuna Cloud Function o regola Firestore esistente cambia
  comportamento: i 5 sender email continuano a scrivere lo stesso
  `template: {name, data}` di oggi, solo la sorgente dell'id template
  cambia da stringa libera a costante del registro — comportamento
  runtime identico, verificabile via test che i nomi risolti non
  cambiano.
- Il sync dei template è forward-only per costruzione (Cloud Function,
  non script locale): scrive solo se eseguita, ogni deploy la esegue sul
  proprio progetto Firebase (staging o prod), nessun rischio di
  ambiente-sbagliato-di-default che affliggerebbe uno script locale con
  un progetto default configurabile.
- Bootstrap del flag `superAdmin`: solo manuale in console Firestore,
  nessuna Cloud Function di questa Epic lo scrive o lo legge per
  concederlo ad altri (decisione esplicita dell'operatore).
- La lettura una tantum dei 4 template esistenti da produzione
  (`enableitalia`) è sola lettura, eseguita fuori da una Cloud Function
  (script/verifica diretta), non un endpoint permanente — stesso spirito
  one-shot già usato per le migrazioni EA-152.
- La spike IAM per il backup precede la scrittura della Cloud Function di
  export: se emergono vincoli bloccanti (costi, permessi non concedibili
  in autonomia), va riportato all'operatore prima di proseguire.

## Concern rilevanti

- [medium] Bucket di destinazione del backup e relativa lifecycle/
  retention policy non ancora decisi — nessuna opzione di questa Epic li
  determina automaticamente. Mitigazione: la spike IAM (Task dedicato)
  deve produrre una proposta concreta (nome bucket, regione, giorni di
  retention) da confermare con l'operatore prima di costruire la Cloud
  Function definitiva.
- [low] Il bootstrap solo-manuale di `superAdmin` significa che se
  l'unico utente con quel flag perde l'accesso, nessuno nell'app può
  riconcederlo senza intervento diretto in console — rischio accettato
  esplicitamente dall'operatore come contropartita di non costruire una
  UI di self-service per un flag così sensibile.

## Opzioni scartate

- Terzo valore di `role` (`"superadmin"` invece di `"admin"`/`"volunteer"`):
  scartata dall'operatore — richiederebbe rivedere ogni controllo
  `role === "admin"` esistente nel codice per decidere se un superadmin
  deve comunque passarli, rischio di rompere qualcosa di già in
  produzione a fronte di nessun beneficio rispetto al flag additivo.
- Export leggero JSON/CSV scaricabile invece di export nativo Firestore
  per il backup: scartata dall'operatore — non è un vero backup
  ripristinabile 1:1, più utile per ispezione che per disaster recovery.
- Sync template bidirezionale (Firestore → repo in continuo, non solo
  come passo di materializzazione una tantum): scartata — il rischio di
  sovrascrivere silenziosamente un hotfix fatto in console è già
  documentato in `ir-email-templates-versioned`; la materializzazione
  una tantum copre il bisogno reale (recuperare lo stato attuale) senza
  reintrodurre quel rischio in modo permanente.

## Source

- request_ref: docs/implementation-requests/email-templates-versioned-request.md
  (per la parte template email — la parte backup e il flag superAdmin
  sono richieste nuove, introdotte in conversazione con il supervisor,
  2026-09-07, senza un proprio implementation-request separato su
  richiesta esplicita dell'operatore di procedere senza il giro completo
  di `solution-study`)
