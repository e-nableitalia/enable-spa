# Liberatoria famiglia: scarico di responsabilità e liberatoria foto sulla deviceRequest

## Stato attuale

`deviceRequests/{id}.status` è oggi uno degli 11 valori macro-stato
(`REQUEST_STATUSES`, `enable-device/src/helpers/requestStatus.ts`,
post riduzione EA-147/148): `inviata`, `validata`, `da gestire`,
`attesa volontario`, `in produzione`, `pronta per spedizione`,
`spedita`, `followup famiglia`, `completata`, `annullata`, `standby`.

La transizione di stato passa da `functions/backend/src/device/changeStatus.ts`,
che valida via `assertVolunteerTransitionAllowed` (RBAC/percorso ammesso
per un volontario) e applica il cambiamento via
`applyStatusChangeTransaction` (transazione Firestore, event sourcing su
`deviceRequests/{id}/events/{eventId}`). Non esiste oggi alcun gate di
business rule indipendente dal ruolo/percorso — nessun campo del
documento `deviceRequests` viene letto per decidere se una transizione è
ammessa oltre a `currentStatus`/`newStatus`/ruolo/assegnazione.

Non esiste alcun campo relativo a liberatorie/consensi della famiglia sul
documento `deviceRequests` (da non confondere con
`requireVolunteerConsents`, consensi privacy del *volontario*, dominio
`volunteer-management`, concettualmente distinto).

## Problema

Nel processo di gestione della richiesta, la famiglia deve fornire due
liberatorie prima che il dispositivo prosegua oltre la fabbricazione:

- **Scarico di responsabilità**: `waiverAcquired: boolean` +
  `waiverAcquiredDate` (data di acquisizione) + `waiverAcquiredBy`
  (uid dell'admin che ha impostato il flag) — **mandatorio**: la
  richiesta non può transitare a `pronta per spedizione`, `spedita` o
  `completata` se questo flag non è `true` con una data valorizzata.
- **Liberatoria foto**: `photoReleaseAcquired: boolean` +
  `photoReleaseAcquiredDate` + `photoReleaseAcquiredBy` — stessa forma,
  ma **non mandatoria**, nessun gate di transizione associato.

Va quindi decisa e realizzata: l'estensione dello schema
`deviceRequests`, la UI per impostare i due flag+data, e il gate di
business rule sulla transizione di stato in `changeStatus.ts`.

## Decisioni (confermate dall'operatore, 2026-08-11)

- **Perimetro RBAC**: solo admin può impostare/modificare i due flag —
  non il volontario assegnato, a differenza di altre azioni sulla
  `deviceRequest` (es. checklist). Trattato come dato amministrativo
  sensibile, dato che blocca una transizione di stato.
- **Ambito del gate**: il blocco si applica a *qualunque* `newStatus` tra
  `pronta per spedizione`, `spedita`, `completata` (le fasi "successive
  alla fabbricazione"), indipendentemente dal `currentStatus` di
  partenza — non solo alla transizione esatta `in produzione` → `pronta
  per spedizione`. Copre quindi anche un eventuale salto diretto da uno
  stato precedente, se mai ammesso da `assertVolunteerTransitionAllowed`.
- **Data di acquisizione**: valorizzata automaticamente
  (`serverTimestamp`) nel momento in cui l'admin imposta il flag a
  `true` in UI — non un date picker separato. Vale per entrambi i flag
  (scarico responsabilità e liberatoria foto).
- **Messaggio di blocco**: un qualsiasi testo che chiarisca all'utente la
  causa del blocco (liberatoria mancante) è sufficiente — nessun
  requisito di copy specifico, `failed-precondition` lato backend resta
  il pattern già usato per altri vincoli di transizione (es. limite
  checklist per richiesta).
- **Retrocompatibilità con richieste esistenti**: nessun backfill/migrazione
  sui dati pregressi — le `deviceRequests` già in `pronta per spedizione`
  o stati successivi restano come sono, il gate si applica solo a
  transizioni *future*.
- **Tracciamento di security esplicito**: chi ha registrato lo scarico di
  responsabilità (quale admin) va tracciato esplicitamente — stesso
  pattern `logSecurityEvent` già usato da ogni Cloud Function mutante di
  questo layer (`action`/`outcome`/`actor`/`context`), più un campo
  `waiverAcquiredBy: uid` (analogo per la liberatoria foto,
  `photoReleaseAcquiredBy`) sul documento `deviceRequests` stesso, per
  tracciabilità diretta oltre al log di sicurezza.

## Aggiornamento (refinement Jira, commento operatore 2026-08-11)

Estensione richiesta durante il refinement dell'Epic EA-157 (Pipeline
Stage riportata a "Needs Refinement" dall'operatore su Jira, con
commento): oltre ai due flag liberatoria, va prevista la gestione
automatica dell'invio email dei documenti alla famiglia.

- **Nuovo campo**: `documentsEmailSent: boolean` su `deviceRequests/{id}`
  — **decisione dell'operatore (2026-08-12): solo booleano**, a
  differenza delle altre due coppie flag+data+uid. Nessun
  `documentsEmailSentDate`/`documentsEmailSentBy` sul documento; il
  tracciamento di *chi* e *quando* passa esclusivamente da
  `logSecurityEvent` (vedi sotto), non da un campo diretto.
- **Command button** (admin, `RequestDetail.tsx`): abilitato solo se
  `deviceRequests/{id}.email` (campo già esistente — stesso usato da
  `createDeviceRequest.ts` per l'email di conferma invio richiesta) è
  valorizzato E `documentsEmailSent === false`. Al click invoca una nuova
  Cloud Function che invia l'email e imposta il flag a `true`
  (idempotente: stesso pattern guard-then-set già visto altrove nel
  dominio, es. l'auto-istanziazione della checklist di produzione in
  `functions/backend/src/device-requests/autoCreateProductionChecklist.ts`).
  **Nota**: da verificare in Story se il campo `email` è davvero sul
  documento principale o (più probabile, coerente con
  `dc-private-data-separation`) nella sub-collection `private/data` come
  altri dati PII della famiglia — il refine di EA-157 aveva già
  segnalato questo dubbio, non ancora risolto con certezza qui.
- **Contenuto email**: trasmissione formale alla famiglia dei documenti
  da firmare (presumibilmente lo scarico di responsabilità stesso) più
  documenti "accessori", informazioni di sicurezza e altro — contenuto
  esatto da definire in Story.
- **Infrastruttura email da riusare, confermata dall'operatore
  (2026-08-12)**: l'estensione Firebase "Trigger Email"
  (`firestore-send-email`) è **già attiva** sul progetto, con supporto
  template nativo configurato — la collection dei template è
  **`emailTemplates`** (nome confermato dall'operatore; non deducibile
  dal codice, dato che la configurazione dell'estensione non è tracciata
  in questo repo, solo sul progetto Firebase live). Riscontro nel codice
  a supporto: `enable-device/src/pages/admin/AdminEmailLogsPage.tsx`
  gestisce già difensivamente un campo `template: { name, data }` sui
  documenti `mail` (righe 37/79-82/195/232-250), lo schema nativo
  dell'estensione quando si usa un template invece di `message.html`
  inline — ma **nessun sender esistente nel codice lo usa ancora**:
  `functions/backend/src/utils/email.ts`
  (`sendRegistrationEmail`/`sendEmailToVolunteersAdmins`/`sendEmailToDeviceAdmins`)
  e `changeStatusNotifications.ts` scrivono tutti `message: { subject,
  html }` con HTML hard-coded inline. Questa Epic introduce quindi il
  **primo utilizzo nel codice** del meccanismo nativo a template
  dell'estensione (scrittura su `mail` con `template: { name: "<id-template-emailTemplates>",
  data: {...} }` invece di `message.html`), non un nuovo sistema di
  templating custom. **Decisione dell'operatore (2026-08-12): il template va creato ex
  novo** in `emailTemplates` — nessun template esistente da riusare per
  questa email. Id/nome esatto del nuovo documento e le variabili
  (`data`) che si aspetta restano da definire in Story.
- **Tracciamento di security esplicito, confermato dall'operatore
  (2026-08-12)**: l'invio dell'email documenti va tracciato come security
  event — stesso pattern `logSecurityEvent` già deciso per i flag
  liberatoria (action/outcome/actor/context), nessun campo aggiuntivo sul
  documento oltre al booleano `documentsEmailSent`.

## Domande aperte per lo studio

- **Visibilità pubblica**: questi due flag (e i relativi `*By`/data) sono
  dati operativi interni (staff-only, come le note della checklist) o
  vanno esposti in qualche proiezione pubblica (`publicDeviceRequests`)?
  Assunzione di partenza: solo interni, da confermare in Story.

## Domini coinvolti

- `device-requests` (`changeStatus.ts`, `applyStatusChangeTransaction.ts`,
  schema `deviceRequests`, vista di dettaglio richiesta admin
  `RequestDetail.tsx` e viste volontario correlate se in RBAC)

## Origine

Richiesta esplicita dell'operatore in conversazione, 2026-08-11: nel
processo di gestione del device deve essere fornita/rilasciata dalla
famiglia una liberatoria — flag "scarico di responsabilità acquisito"
(con data), mandatorio con la relativa data per poter far transitare la
richiesta dalla fase di fabbricazione in poi (richiesta di spedizione a
seguire); flag "liberatoria foto acquisita" (con data), non mandatorio.
