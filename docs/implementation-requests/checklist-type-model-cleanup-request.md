# Pulizia post-EA-121: codice morto e gap sul modello `type` dei checklist item

## Stato attuale

L'Epic EA-121 (discriminante `type` esplicito su `ChecklistItem`, core
Organizer) è Done. Durante la sua implementazione e nella review
successiva sono emersi tre findings indipendenti, ciascuno già con una
decisione presa in conversazione con il supervisor (sessione
2026-08-05), non ancora tradotta in codice.

## Decisioni prese, da implementare

### 1. Rimuovere lo shorthand a stringa per item ([[F-6]], [[F-7]])

`normalizeInitialItem` (`functions/backend/src/organizer/createChecklist.ts`)
e `normalizeTemplateItem` (duplicata identica in `createTemplate.ts` e
`updateTemplate.ts`) accettano ancora un ramo `typeof input === "string"`
per item espressi come semplice titolo. Da quando `type` è obbligatorio
(EA-123/EA-125) quel ramo fallisce sempre con `invalid-argument`: è
codice morto per qualunque consumer reale.

- Rimuovere il branch `typeof input === "string"` da entrambe le
  funzioni di normalizzazione.
- Valutare, in questa stessa occasione, se convenga estrarre
  `normalizeTemplateItem` (oggi duplicata identicamente in
  `createTemplate.ts`/`updateTemplate.ts`) in un modulo condiviso —
  non obbligatorio, ma i due file cambiano insieme da quando esiste il
  discriminante `type`.
- Aggiornare/rimuovere i test che verificano esplicitamente il rifiuto
  dello shorthand a stringa (`createChecklist.test.ts`,
  `createTemplate.test.ts`, `updateTemplate.test.ts`), dato che il ramo
  che testano sparisce.

### 2. Esporre `completed` in `updateChecklistItem` ([[F-11]]) — RISOLTO (Story Jira EA-145, 2026-08-05)

Nessuna Cloud Function scrive mai `completed: true` su un item: il
ramo `boolean` del gate di completezza (`isBooleanItemComplete`,
`checklistCompleteness.ts`) è irraggiungibile in produzione.

- Fatto: `completed` (boolean) è ora tra i campi aggiornabili di
  `functions/backend/src/organizer/updateChecklistItem.ts`, simmetrico
  a come `status`/`type` sono già aggiornabili.
- Fatto: `functions/backend/src/device-requests/updateDeviceRequestChecklistItem.ts`
  inoltra `completed` al core, stesso perimetro RBAC già applicato da
  `resolveDeviceRequestChecklistAccess` — evitato lo stesso problema
  visto in [[F-12]] (campo aggiunto al core ma non inoltrato dal layer
  `device-requests`).
- Ancora aperto, fuori dal perimetro di EA-145 (Story separata della
  stessa Epic EA-135, dipendente da questa): il controllo UI in
  `enable-device/src/components/checklist/ChecklistPanel.tsx` per
  marcare un item `boolean` come completato (oggi la colonna "Stato"
  gestisce solo item `generic`/`numeric`; un item `boolean` non ha
  ancora un controllo UI equivalente per `completed`).

## Fuori scope

- F-4 (dropdown di stato mai disabilitato) — resta sospeso, richiede
  chiarimento con chi ha validato lo staging prima di essere
  trasformato in richiesta.
- F-9/F-10 (default `"generic"` per item legacy privi di `type`) —
  confermati come comportamento voluto, nessuna azione di codice.
- F-5 (chiave `quantity` sempre scritta) — chiuso come risolto,
  superato dal gate type-aware di EA-127 (non distingue più
  chiave-assente da chiave-`null`).

## Domini coinvolti

- `process-organizer-core` (`normalizeInitialItem`,
  `normalizeTemplateItem`, `updateChecklistItem`)
- `device-requests` (verifica inoltro `completed` in
  `updateDeviceRequestChecklistItem` e UI `ChecklistPanel.tsx`)

## Origine

Findings F-6, F-7, F-11 (`docs/FINDINGS.md`), decisioni prese in
conversazione con il supervisor, sessione 2026-08-05.
