# Progetti speciali / iniziative, con todo-list collegate

## Stato attuale

Non esiste oggi alcun concetto di "progetto speciale" o "iniziativa" nel
codice né in `docs/`: verificato che nessun file menziona qualcosa di
simile a un'entità di questo tipo.

Esiste però il terreno preparato per riusarlo: `process-organizer-core`
(`functions/backend/src/organizer/**`) è un motore di checklist
esplicitamente generico, descritto nel suo stesso manifest come "pensato
per essere riusato oltre il caso device (es. organizzazione eventi/
workshop in futuro)". Il core espone già un campo `category` su
checklist/template — "identificatore di categoria opaco" che il core non
interpreta mai, riempito oggi dal solo consumer `device-requests` (con
valore fisso legato alla richiesta) e usato anche come filtro di "scope"
da `listMyChecklistItems` (todo-list personale del volontario, Epic
EA-134/EA-142). Un secondo consumer del core (questa richiesta) è quindi
già nel perimetro di design previsto, non un'estensione forzata.

**Punto di attenzione**: il "categoria/tipo" di iniziativa richiesto qui
sotto (progetto vs evento) rischia di sovrapporsi nel nome, ma non nel
significato, al campo `category` già esistente sul core (oggi usato come
scope opaco per il filtro della todo-list). Da chiarire nello studio se
sono lo stesso campo con valori diversi o due concetti distinti — se
distinti, va scelto un nome che non collida con `category`.

## Problema

Servono strumenti per tracciare iniziative che non sono una `deviceRequest`
ma richiedono comunque liste di attività/task da assegnare e seguire nel
tempo. Due esempi concreti portati dall'operatore:

- **Progetto tecnico** (es. "device multifunzione"): cicli di sviluppo,
  integrazione e test.
- **Evento** (es. Maker Faire, o altri eventi): attività di preparazione,
  allestimento, e durante lo svolgimento.

## Decisioni confermate dall'operatore (2026-09-06/07)

- **Entità propria**: un'iniziativa non è solo "una checklist taggata" —
  serve un documento/entità a sé stante (oltre alla/e checklist
  collegate).
- **Naming interno**: l'entità si chiama internamente **"project"**
  (`projects/{projectId}`, non "initiative") — progetti tecnici ed eventi
  sono lo stesso concetto di fondo, distinti da un campo di
  classificazione **`projectType`** (non `initiativeType`, per coerenza
  col nome dell'entità). Valori iniziali: `progetto`, `iniziativa`,
  `evento` — elenco pensato per essere esteso in futuro, non un enum
  chiuso a 3 valori per sempre. Permette viste filtrate separate (es.
  lista eventi, lista progetti) invece di un elenco unico
  indifferenziato. **Nota naming**: `projectType` è un campo distinto dal
  `category` opaco già esistente sul core Organizer (usato come scope
  per `listMyChecklistItems`) — nessuna collisione, sono due concetti
  diversi nonostante il rischio di confusione terminologica segnalato
  sopra.
- **Stato**: enum a 5 valori — `new` (appena creata), `active`,
  `standby`, `archived`, `closed`. Restrizioni di modifica legate allo
  stato: in `archived`/`closed` nessuna modifica è più permessa
  (entità/checklist/allegati bloccati in sola lettura); in `standby` è
  permessa solo l'aggiunta di note, nessun'altra modifica.
- **RBAC di creazione**: solo admin può creare un progetto/iniziativa.
- **RBAC di assegnazione item**: sia admin sia volontari possono essere
  assegnatari di un item di checklist collegata (coerente con l'RBAC già
  esistente su `device-requests`, non solo admin).
- **Owner/creatore**: tracciato esplicitamente `createdBy` (uid) e
  `createdAt`, oltre allo stato.
- **Descrizione**: campo descrizione libera sull'entità.
- **Note/cronologia**: stesso pattern di `deviceRequests` — una
  sottocollezione eventi con possibilità di aggiungere una nota in
  qualunque momento (anche in `standby`, l'unica modifica ammessa in
  quello stato), non solo un campo testo statico.
- **Checklist collegate**: elenco (array), non una singola checklist —
  vedi decisione dello studio `ss-special-projects-initiatives` sotto.
- **Allegati**: previsto fin da subito l'aggancio alla capability di base
  "Allegati" (EA-161/168), stesso pattern di integrazione già usato per
  device-requests (nuovo modulo RBAC + wrapper dedicati per il dominio
  progetti), non una funzionalità rimandata.
- **Todo-list volontario**: il "leak" verso `listMyChecklistItems` quando
  `category`/scope è valorizzato in modo coerente è **comportamento
  voluto**, non un effetto collaterale da correggere.

## Nota di sequenza: allegati

`ir-cross-entity-attachments` è stata resequenziata (2026-09-06) per
essere costruita come capability di base della piattaforma *prima* di
essere integrata nei domini consumer, proprio per evitare che
l'implementazione di questa richiesta debba prevedere un proprio step
separato per gli allegati. **Aggiornamento (2026-09-07)**: la capability
di base è ora realmente implementata e mergiata (Epic EA-161, Story
EA-162→167 — Cloud Storage nativo + signed URL, RBAC staff-only con
ownership), e il primo pattern di integrazione in un dominio consumer
esiste già come esempio concreto da riusare (Story EA-168, layer
`device-requests`: modulo RBAC dedicato + wrapper Cloud Function che
delegano via `.run()` alle funzioni generiche). Quando questa richiesta
verrà implementata, l'aggancio agli allegati per i progetti dovrebbe
replicare lo stesso pattern (nuovo modulo RBAC + wrapper equivalenti per
il dominio "projects"), non progettarlo da zero.

## Domande aperte per lo studio

- **Checklist collegate**: risolto dallo studio `ss-special-projects-initiatives`
  (opt-b raccomandata, in linea con la decisione confermata sopra) — array
  `checklists: {checklistId, label}[]` sull'entità, non una singola
  checklist. Stesso pattern già deciso per `deviceRequest` via
  `checklistIds[]` (EA-130/EA-133), qui con `label` fin dal giorno 1.
- **Collocazione UI**: le viste filtrate (lista eventi, lista progetti)
  sono pagine admin nuove dedicate, o si integrano in viste esistenti? Non
  ancora deciso.
- **Restrizioni di modifica per stato**: risolto sopra (`archived`/`closed`
  bloccati, `standby` solo note) — resta da definire in Story il dettaglio
  implementativo esatto (validazione lato Cloud Function su ogni mutazione,
  incluse quelle su checklist/allegati collegati, non solo sull'entità
  progetto stessa).
- **Naming**: risolto sopra — `projectType` (non `category`, non
  `initiativeType`), nessuna collisione col `category` opaco del core.

## Domini coinvolti

- `process-organizer-core` (consumer, nessun cambiamento al core atteso
  se non eventuale generalizzazione già prevista dal design)
- `attachments` (consumer, secondo dominio a integrare la capability di
  base dopo `device-requests`, stesso pattern EA-168)
- Nuovo dominio candidato: **`projects`** (non ancora nel
  domain-manifest) — entità progetto/iniziativa/evento, stato,
  RBAC di creazione, cronologia/note, viste filtrate.

## Origine

Richiesta esplicita dell'operatore in conversazione, 2026-09-06, mentre si
discuteva il perimetro dello studio sui template email: l'operatore ha
introdotto l'esigenza di gestire progetti speciali/iniziative (device
multifunzione, Maker Faire e altri eventi) con todo-list associate.
