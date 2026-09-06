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

## Decisioni confermate dall'operatore (2026-09-06)

- **Entità propria**: un'iniziativa non è solo "una checklist taggata" —
  serve un documento/entità a sé stante (oltre alla/e checklist
  collegate).
- **Progetti tecnici ed eventi sono lo stesso concetto di fondo**, ma da
  trattare con categorie/tipi distinti, per poter presentare viste
  filtrate separate (es. lista eventi, lista progetti) invece di un
  elenco unico indifferenziato.
- **Stato**: ogni iniziativa ha un macro-stato, almeno "attivo"/"chiuso".
- **RBAC di creazione**: solo admin può creare un'iniziativa.

## Nota di sequenza: allegati

`ir-cross-entity-attachments` è stata resequenziata (2026-09-06) per
essere costruita come capability di base della piattaforma *prima* di
essere integrata nei domini consumer, proprio per evitare che
l'implementazione di questa richiesta debba prevedere un proprio step
separato per gli allegati: quando si arriverà a questa richiesta,
l'aggancio agli allegati dovrebbe essere una semplice integrazione a una
capability già pronta, non un lavoro da progettare da zero qui.

## Domande aperte per lo studio

- **Checklist collegate**: una sola per iniziativa, o multiple nel tempo
  (come già avviene per `deviceRequest` via `checklistIds[]`, EA-130/
  EA-133)? Un progetto tecnico con cicli di sviluppo/integrazione/test
  suggerisce più checklist successive (una per ciclo) — da confermare se
  è così o se un'unica checklist con item raggruppati per fase basta.
- **Assegnazione item**: solo admin può essere assegnatario di un item su
  un'iniziativa, o anche volontari (coerente con l'RBAC già esistente su
  `device-requests`)?
- **Owner/creatore**: serve tracciare chi ha creato l'iniziativa oltre al
  suo stato (pattern già esistente `createdBy` su `checklists`, F-1)?
- **Collocazione UI**: le viste filtrate (lista eventi, lista progetti)
  sono pagine admin nuove dedicate, o si integrano in viste esistenti?
- **Interazione con la todo-list volontario**: un volontario assegnato a
  un item di un'iniziativa comparirebbe già oggi nella sua todo-list
  personale (`listMyChecklistItems`) se lo scope/`category` è valorizzato
  in modo coerente — da confermare se questo comportamento "gratuito" è
  desiderato così com'è.
- **Naming**: vedi punto di attenzione sopra su `category`/tipo iniziativa.

## Domini coinvolti

- `process-organizer-core` (consumer, nessun cambiamento al core atteso
  se non eventuale generalizzazione già prevista dal design)
- Nuovo dominio candidato (non ancora nel domain-manifest): gestione delle
  iniziative stesse (entità, stato, RBAC di creazione, viste filtrate) —
  da nominare in fase di studio.

## Origine

Richiesta esplicita dell'operatore in conversazione, 2026-09-06, mentre si
discuteva il perimetro dello studio sui template email: l'operatore ha
introdotto l'esigenza di gestire progetti speciali/iniziative (device
multifunzione, Maker Faire e altri eventi) con todo-list associate.
