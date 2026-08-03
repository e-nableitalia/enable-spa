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

## Direzione proposta in origine (da trattare come una delle opzioni, non una decisione già presa)

- Passare da `deviceRequest.checklistId` (singolare) a una relazione
  1:N (es. `checklistIds: string[]`, o sottocollezione dedicata).
- UI: vista a tab in `RequestDetail.tsx` per navigare tra le checklist
  associate a una stessa richiesta, invece del pannello singolo
  `ChecklistPanel` attuale.
- Alla creazione, se esistono più template candidati per il
  devicetype, permettere scelta esplicita invece di auto-selezionare
  il primo.

## Domande di design da esplorare nello studio

1. **Modello dati**: campo array `checklistIds: string[]` su
   `deviceRequest` vs sottocollezione dedicata
   (`deviceRequests/{id}/checklists/{checklistId}` o simile). Trade-off
   su query, atomicità degli aggiornamenti, e coerenza con
   `assignedVolunteers` (già un array su `deviceRequest`, precedente
   nello stesso documento).
2. **Retrocompatibilità con `checklistId` esistente**: ogni
   `deviceRequest` già in produzione ha (se presente) un solo
   `checklistId` singolare. Va deciso se mantenere quel campo come
   "prima checklist"/legacy accanto al nuovo modello 1:N, o migrare
   esplicitamente (con che strategia, dato che — come emerso nello
   studio sul modello item — potrebbe non esserci ancora dato reale da
   migrare in produzione).
3. **Selezione template**: quando ci sono più template candidati per
   lo stesso devicetype, la UI deve offrire una scelta esplicita
   invece dell'auto-selezione sulla prima corrispondenza — va deciso
   se questo è nello scope di questo studio o un cambio indipendente
   (auto-selezione arbitraria è un problema anche nel modello 1:1
   attuale, non solo in quello 1:N).
4. **Funzioni da rivedere**: `getDeviceRequestChecklist`,
   `getDeviceRequestChecklistCompleteness`,
   `cloneDeviceRequestChecklist`, `createChecklistShareLink`/
   `getChecklistShareStatus`, `createDeviceRequestChecklist` assumono
   oggi tutte "la" checklist di una richiesta (via `checklistId`
   singolare) — ciascuna richiede una decisione esplicita su come
   comportarsi con più checklist (es. quale checklist condividere via
   link pubblico, come calcolare una percentuale di completamento
   aggregata o per-checklist).

## Domini coinvolti

- `device-requests` (schema `deviceRequest`, Cloud Function di
  integrazione, UI `RequestDetail.tsx`)
- `process-organizer-core` (nessun impatto diretto sul core: la
  cardinalità è decisa interamente dal consumer, coerente con il
  confine architetturale EA-3)

## Origine

Richiesta di implementazione `ir-multi-checklist-per-device-request`,
emersa durante la validazione su staging (`enableitalia-staging`) dei
flussi checklist, tenuta esplicitamente fuori scope dallo studio
sull'evoluzione del modello item (`ss-checklist-item-model`, Epic
EA-121, ora completata) perché cambio di cardinalità della relazione,
non di forma dell'item.
