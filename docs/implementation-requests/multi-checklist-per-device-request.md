# Checklist multiple per singola deviceRequest

## Stato attuale

Il modello di integrazione Organizer↔device-requests (EA-108) è oggi
1:1: ogni `deviceRequest` ha al più un `checklistId` (campo singolare
su `deviceRequests/{id}`). Quando una `deviceRequest` viene creata e
per il suo `devicetype` esistono **più template** di checklist nel
catalogo (`organizer/createTemplate`, filtrabili per categoria), la
selezione del template da istanziare avviene **automaticamente sulla
prima corrispondenza**, senza permettere una scelta esplicita
all'utente. Lo stesso vale concettualmente per la clonazione (EA-112,
`cloneDeviceRequestChecklist`): oggi clona da un'unica checklist
sorgente in un'unica checklist destinazione, sempre nell'assunzione
1:1.

## Problema

Un device può ragionevolmente richiedere più checklist indipendenti in
parallelo (es. una di fabbricazione e una di collaudo/qualità, o più
fasi distinte con owner diversi), oppure semplicemente più template
alternativi per lo stesso devicetype tra cui scegliere invece che
subire una selezione automatica arbitraria.

## Idea proposta (da esplorare, non ancora decisa)

- Passare da `deviceRequest.checklistId` (singolare) a una relazione
  1:N (es. `checklistIds: string[]`, o sottocollezione dedicata).
- UI: vista a tab in `RequestDetail.tsx` per navigare tra le checklist
  associate a una stessa richiesta, invece del pannello singolo
  `ChecklistPanel` attuale.
- Alla creazione, se esistono più template candidati per il
  devicetype, permettere scelta esplicita invece di auto-selezionare
  il primo.

## Perché non è nello studio "evoluzione modello item checklist"

È un cambio di **cardinalità della relazione** device↔checklist, non
di forma dell'item — tocca schema dati (`deviceRequests`), UI di
navigazione (tab), e le funzioni che oggi assumono "la" checklist di
una richiesta (`getDeviceRequestChecklist`,
`getDeviceRequestChecklistCompleteness`,
`cloneDeviceRequestChecklist`, `createChecklistShareLink`/
`getChecklistShareStatus`). Scala di intervento diversa, da valutare
come studio a sé.

## Domini coinvolti

- `device-requests` (schema `deviceRequest`, Cloud Function di
  integrazione, UI `RequestDetail.tsx`)
- `process-organizer-core` (nessun impatto diretto sul core: la
  cardinalità è decisa interamente dal consumer, coerente con il
  confine architetturale EA-3)

## Origine

Emerso in conversazione con il supervisor durante la validazione su
staging (`enableitalia-staging`) dei flussi checklist, in parallelo
allo studio sull'evoluzione del modello item (`ss-checklist-item-model`).
