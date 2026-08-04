# Todo-list personale per utente su process-organizer-core

## Stato attuale

Gli item di checklist vivono oggi come **array embedded** su
`checklists/{id}.items` (non una subcollection né una collection
propria): `addChecklistItem.ts` scrive con `arrayUnion`,
`updateChecklistItem.ts`/`removeChecklistItem.ts` leggono l'intero
array, lo modificano in memoria e lo riscrivono per intero. Non esiste
oggi alcuna query Firestore capace di attraversare più documenti
`checklists/{id}` filtrando per un campo di un singolo item (es.
"tutti gli item con `assignee == X`, in qualunque checklist").

`assignee` è inoltre una stringa opaca scelta dal consumer (non un
riferimento reale a un utente/volontario autenticato) — punto già
segnalato come rimandato durante lo studio `ss-checklist-item-model`
("la promozione a riferimento reale a un volontario è un cambio
ortogonale... non nel core").

## Problema

Manca un modo per un utente di vedere, in un unico posto, tutti gli
item di checklist a lui assegnati — indipendentemente da quale
checklist/consumer li contiene — con la possibilità di presentarli
raggruppati/filtrati per un "ambito" (es. tutte le richieste device, o
un progetto/iniziativa specifica).

## Idea proposta (da esplorare, non ancora decisa)

Una todo-list personale per utente, costruita come aggregazione
cross-checklist degli item assegnati a quell'utente. Punti emersi in
conversazione con il supervisor (sessione 2026-08-05), non ancora
risolti in una direzione unica:

- **Aggregazione**: cross-checklist globale per utente, ma con uno
  "scope" esplicito e arbitrario per item/checklist (non una query
  complessa tipo "tutte le deviceRequest con volontario assegnato" —
  un'etichetta di ambito impostata dal consumer, es. "richieste
  device", "progetto X", "iniziativa Y"), usata poi per filtrare la
  vista aggregata. Da chiarire se questo "scope" sia un concetto nuovo
  o possa riusare `category` (già esistente sul core, oggi usata per
  `devicetype`).
- **Sincronizzazione**: se gli item diventano interrogabili
  direttamente (es. spostandoli in una subcollection
  `checklists/{id}/items/{itemId}` invece che array embedded), la
  todo-list personale può essere una **pura vista/query filtrata** sugli
  stessi documenti — non serve alcuna sincronizzazione bidirezionale
  né una copia separata dei dati. Questo però richiede prima decidere
  se/come cambiare la struttura di storage degli item (oggi array
  embedded, non query-friendly cross-documento).
- **Identità assignee**: la todo-list presuppone che `assignee` sia (o
  sia affiancato da) un riferimento reale a un utente autenticato
  (uid), non solo una stringa libera — necessario per poter fare
  "tutti gli item con assignee == uid dell'utente loggato".

## Vincolo importante: nessun dato reale da migrare

Esistono oggi solo 4 checklist di test create dall'operatore stesso
per validare il modello `type` (nessun utilizzo reale in produzione né
in staging oltre a quei test). Questo rimuove il vincolo di
compatibilità/dual-read per qualunque opzione che cambi la struttura
di storage degli item (es. array embedded → subcollection): le 4
checklist di test possono essere eliminate a mano se un'opzione lo
richiede, invece di dover progettare una migrazione o una fase di
coesistenza. Le opzioni esplorate da questo studio possono quindi
assumere libertà piena sul modello dati, senza il tipo di vincolo
gestito ad es. in [[F-18]] per `checklistId` → `checklistIds[]`
(quel caso aveva dati reali da verificare/bonificare, questo no).

## Domande aperte per lo studio

- Il core deve conoscere il concetto di "utente autenticato" (rompendo
  parzialmente l'agnosticismo attuale rispetto al consumer), o deve
  restare un identificatore opaco e la risoluzione a un utente reale
  resta responsabilità del consumer (`device-requests` oggi,
  eventualmente altri consumer futuri)?
- Se si cambia la struttura di storage degli item (subcollection vs
  array embedded), quali funzioni del core sono impattate e con che
  ampiezza? (Praticamente tutte: create/add/update/remove/clone/get*.)
- RBAC: un utente deve poter vedere solo i propri item assegnati — è
  un nuovo tipo di controllo di accesso rispetto a quelli esistenti
  (oggi RBAC è per operazione su una checklist nota, non per query
  aggregata cross-checklist).
- Lo "scope"/ambito è un concetto del core (riusando o affiancando
  `category`) o è responsabilità del consumer aggregare/filtrare lato
  proprio dominio?

## Domini coinvolti

- `process-organizer-core` (modello dati item, eventuale nuova
  capability di query/aggregazione, RBAC)
- `device-requests` (primo consumer reale: popolerebbe lo "scope" con
  qualcosa come "richieste device", e consumerebbe la todo-list per i
  volontari assegnati)

## Origine

Emerso in conversazione con il supervisor durante il punto sui
findings aperti del cluster checklist-type-model, sessione 2026-08-05.
