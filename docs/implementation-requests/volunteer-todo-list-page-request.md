# Pagina "I miei item" per il volontario — riepilogo cross-checklist

## Stato attuale

Il backend per questa funzionalità è già pronto e mergeato su `develop`,
implementato dalla serie EA-137→EA-142 sulla base dello studio deciso
`ss-user-todo-list` (opt-e, 2026-08-04): `listMyChecklistItems(uid?,
scope?)` (`functions/backend/src/organizer/listMyChecklistItems.ts`,
EA-142/PR #71) esegue una query self-only (l'utente vede solo i propri
item assegnati, salvo un admin che passi un `uid` esplicito) sulla
collection di primo livello `checklistItems`, filtrata per `assignee` e
opzionalmente per `scope`/`category`. Per gli item non completati
arricchisce il risultato con `origin` (contesto della checklist di
provenienza).

**Nessun consumer frontend esiste oggi**: verificato che
`enable-device/src` non contiene alcun riferimento a
`listMyChecklistItems`. Questa request copre esclusivamente la UI
mancante — nessuna decisione architetturale nuova da prendere, non
serve un nuovo solution-study.

## Problema

Un volontario non ha oggi alcun modo di vedere in un unico posto tutti
gli item di checklist a lui assegnati, cross-checklist e
cross-`deviceRequest`. Deve aprire singolarmente ogni richiesta
assegnata e controllare a mano le checklist collegate.

## Proposta

Nuova pagina in `enable-device/src/pages/volunteer/` che, all'apertura,
chiama `listMyChecklistItems` (`httpsCallable`) e mostra l'elenco degli
item assegnati al volontario loggato: titolo item, stato, e — per gli
item non completati — l'`origin` restituito dalla funzione come contesto
di provenienza (verso quale checklist/richiesta appartiene).

## Domini coinvolti

- `process-organizer-core` — consumer di `listMyChecklistItems`, nessuna
  modifica al core.
- `device-requests` — contesto/origin degli item, eventuale navigazione
  dalla riga item verso `VolunteerRequestDetail.tsx`.

## Domande aperte per l'implementazione (dettagli, non bloccanti)

- Routing/raggiungibilità: nuova voce di menu in `VolunteerLayout.tsx`,
  o pagina raggiungibile solo da link diretto? (Vedi F-33 in
  `docs/FINDINGS.md`, stesso pattern di rischio già osservato su
  `AdminMaintenanceRequests.tsx`: uno strumento pensato per uso corrente
  non dovrebbe restare raggiungibile solo conoscendo l'URL a memoria.)
- Filtro per `scope`: la funzione lo supporta già come parametro
  opzionale — serve esporlo come filtro in UI, o si mostra sempre tutto?
- Raggruppamento/ordinamento: per checklist/richiesta di provenienza,
  per data, o lista piatta?

## Origine

Richiesta esplicita dell'operatore in conversazione, sessione
2026-08-09, subito dopo la chiusura dell'Epic EA-147
(device-request-macro-status). Contestualmente l'operatore ha anche
chiesto di poter avere più checklist per device: verificato nel codice
che è già interamente implementato (serie EA-128→EA-133, array
`checklistIds` con limite `MAX_CHECKLISTS_PER_REQUEST = 5`, UI a tab
già presente sia in `RequestDetail.tsx` sia in
`VolunteerRequestDetail.tsx`) — nessuna azione richiesta su quel punto.
