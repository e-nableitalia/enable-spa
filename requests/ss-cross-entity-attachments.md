# Allegati come funzionalità di base della piattaforma, con integrazione per dominio a step successivi

## Stato attuale

Nessuna infrastruttura di allegati/file esiste oggi nell'applicazione:
verificato che non c'è alcun uso di Firebase Storage nel codice (nessun
`getStorage`/`uploadBytes`/riferimento a uno Storage bucket), nessun file
`storage.rules`, e nessuna sezione `storage` in `firebase.json`. Il
progetto Firebase non ha Storage provisionato per l'app: questa richiesta
introduce l'intera infrastruttura da zero (regole di sicurezza incluse),
non solo la UI di upload.

## Problema

Serve un modo per allegare file a entità applicative — inizialmente
`deviceRequest`, poi le iniziative/progetti speciali
(`ir-special-projects-initiatives`, se e quando implementata) — visibile e
gestibile trasversalmente invece di essere reinventato per ogni dominio.

## Sequenza di sviluppo confermata dall'operatore (2026-09-06)

A differenza di come impostato inizialmente in questa richiesta (allegati
legati da subito a `deviceRequest`), l'operatore ha chiesto di invertire
l'ordine:

1. **Prima**: costruire la gestione allegati come **capability di base
   della piattaforma**, indipendente da qualunque entità consumer —
   storage, modello dati, RBAC di caricamento/modifica/eliminazione (già
   deciso sotto), senza ancora agganciarla a `deviceRequest` o ad altro.
2. **Poi**: integrare quella capability nei domini che ne hanno bisogno —
   `device-requests` come primo consumer reale, `ir-special-projects-initiatives`
   come secondo.

**Motivazione esplicita**: se gli allegati esistono già come funzionalità
di base quando si arriverà a implementare i progetti speciali/iniziative,
quel lavoro non andrà diviso in due step separati (prima l'entità, poi gli
allegati collegati) — l'integrazione sarà solo un aggancio a una capability
già pronta.

## Decisione da validare in studio: dove vivono i file

L'operatore ha proposto (2026-09-06) di usare **uno spazio dedicato su
Google Drive** invece di Firebase Storage come backend di archiviazione
dei file. Non è ancora una decisione chiusa: comporta implicazioni
significative che lo studio deve pesare esplicitamente, non solo
implementare:

- **Modello di accesso**: Google Drive non ha un equivalente diretto delle
  Firebase Security Rules basate su path — il controllo RBAC (staff-only,
  admin vs volontario) andrebbe implementato o tramite permessi di
  condivisione Drive gestiti via API (service account con delega, o account
  dedicato) e mai esposti direttamente al client, oppure tramite un layer
  Cloud Function che fa sempre da proxy tra client e Drive (nessun link
  Drive diretto in mano al frontend). La seconda opzione è più vicina al
  perimetro RBAC già deciso sopra (differenziare admin/volontario), la
  prima rischia di essere più permissiva di quanto voluto.
- **Dipendenza esterna nuova**: Google Drive API richiede credenziali
  dedicate (service account con accesso allo spazio Drive, o OAuth),
  quota/rate limit propri distinti da Firestore/Storage, e un nuovo punto
  di fallimento esterno al progetto Firebase.
- **Confronto con Firebase Storage nativo**: quest'ultimo si integra
  direttamente con le Security Rules e l'Auth già esistenti (stesso
  pattern RBAC di Firestore, nessuna credenziale aggiuntiva da gestire),
  ma non offre lo spazio "a costo prevedibile"/gestito a mano che
  l'operatore associa a Drive.
- Lo studio deve presentare questo come una scelta esplicita con
  trade-off (non assumere Drive per il solo fatto che sia stato nominato
  in conversazione), includendo il costo di un'eventuale migrazione futura
  se la scelta iniziale si rivelasse sbagliata.

## Decisioni confermate dall'operatore (2026-09-06)

- **Perimetro delle entità**: solo entità di alto livello (`deviceRequest`,
  progetti speciali) — non previsto, per ora, a livello di singolo item di
  checklist.
- **Contenuto**: qualsiasi file generico, con una descrizione associata
  (non tipizzato per categoria di documento).
- **Visibilità**: solo staff, definito esplicitamente come admin +
  volontari — dati di gestione dell'attività, mai esposti alla famiglia/
  richiedente né fuori da questi due ruoli (a differenza dello share-link
  di sola consultazione già esistente sulla checklist, EA-113).
- **RBAC di caricamento/modifica/eliminazione**: sia admin sia volontario
  possono caricare un allegato. In modifica ed eliminazione, admin può
  modificare/eliminare qualunque allegato; il volontario può
  modificare/eliminare solo quelli caricati da lui stesso.

## Domande aperte per lo studio

- **Storage backend**: Google Drive (spazio dedicato) vs Firebase Storage
  — vedi sezione dedicata sopra, decisione esplicita richiesta con
  trade-off, non assunta.
- **Vincoli tecnici**: limiti di dimensione/tipo file, quota per
  entità/totale, virus-scan o altra validazione — nessuno ancora deciso,
  e dipendono in parte dal backend scelto (Drive ha propri limiti/quota
  diversi da Storage).
- **Modello dati Firestore**: la capability di base ha comunque bisogno di
  un riferimento Firestore per ogni allegato (metadati: descrizione,
  `uploadedBy`, entità proprietaria, e riferimento al file reale su
  Drive/Storage) — subcollection dedicata su ciascuna entità (es.
  `deviceRequests/{id}/attachments/{attachmentId}`) vs. collection di
  primo livello con riferimento all'entità proprietaria (pattern già
  scelto per `checklistItems`, EA-137). Il secondo pattern è quello che
  meglio si presta a essere "capability di base" riusabile da più domini
  senza ripetere lo schema per ognuno.
- **Sicurezza dei file**: qualunque sia il backend, l'accesso deve
  replicare lo stesso perimetro RBAC di Firestore (staff-only) — nessun
  link/path indovinabile, nessun accesso anonimo diretto ai file.
- **Superficie della capability di base**: quali operazioni espone al
  consumer (upload/list/update-description/delete) e con quale contratto,
  in modo che agganciare un nuovo dominio (es. progetti speciali) resti
  davvero un'integrazione leggera come da obiettivo della sequenza sopra.

## Domini coinvolti

- Nuovo dominio candidato per la capability di base (nome da decidere in
  studio, es. "attachments") — non ancora nel domain-manifest.
- `device-requests` (primo dominio consumer/integrazione, step 2)
- Nuovo dominio candidato "progetti speciali/iniziative", se implementato
  (`ir-special-projects-initiatives`) — secondo consumer/integrazione,
  step 2, pensato per non richiedere un proprio step di allegati separato.

## Origine

Richiesta esplicita dell'operatore in conversazione, 2026-09-06, insieme
alla richiesta di progetti speciali/iniziative: la gestione allegati è
stata descritta come trasversale, non limitata a un solo dominio, e da
costruire come capability di base della piattaforma prima di integrarla
nei domini specifici — per non dover ripetere il lavoro di integrazione
allegati separatamente per ogni nuova entità (in particolare per evitare
di dividere in due step il lavoro sui progetti speciali/iniziative).
