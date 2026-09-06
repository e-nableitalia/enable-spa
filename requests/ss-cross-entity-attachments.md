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

## Ripensamento architetturale (2026-09-06, dopo il refine con eccezione superadmin)

Dopo che il primo refine dello studio ha spostato la raccomandazione su
Option B (Drive) proprio per soddisfare l'eccezione di accesso diretto
superadmin, l'operatore ha rimesso in discussione la logica di fondo:

- I costi di storage/trasferimento su Cloud Storage nativo sono minimi —
  cade quindi l'argomento "costo prevedibile" che aveva pesato a favore
  di Drive.
- Nuova proposta per Option A: il backend fa da **frontend verso Cloud
  Storage** — le Cloud Function si limitano a RBAC e generazione di
  **signed URL** per upload/download; il trasferimento byte reale avviene
  client↔GCS direttamente tramite la signed URL, non proxato attraverso
  la Cloud Function (risolve esplicitamente il sotto-punto lasciato aperto
  in Option A su "signed URL vs accesso diretto SDK+Rules").
- L'eccezione superadmin si risolverebbe con un **ruolo IAM nativo di
  Google Cloud Storage** (es. Storage Admin) concesso ai pochi superadmin,
  scoped al bucket/prefix degli allegati — non un secondo sistema esterno
  come Drive.
- Da verificare esplicitamente nello studio: l'affermazione del refine
  precedente ("Option A richiederebbe IAM a livello di intero progetto
  GCP, non della sola cartella allegati") è accurata, o GCS supporta IAM
  Conditions scoped a bucket/prefix che renderebbero l'eccezione superadmin
  ugualmente scoped anche con Option A? Se sì, la raccomandazione andrebbe
  rivalutata.

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
- **Eccezione di accesso diretto allo spazio Drive** (2026-09-06, in
  risposta alla raccomandazione dello studio `ss-cross-entity-attachments`):
  oltre all'accesso mediato da Cloud Function (Opt B, riservato ad
  admin+volontario secondo l'RBAC sopra), lo spazio Drive dedicato prevede
  anche un accesso diretto nativo — fuori dall'app — riservato a un numero
  ristretto di **superadmin**. Non sostituisce l'RBAC applicativo per lo
  staff normale, che resta interamente mediato dalla Cloud Function:
  è un canale aggiuntivo di supervisione/backup diretto sullo spazio,
  voluto esplicitamente nonostante comporti — per costruzione — la
  possibilità per quei superadmin di vedere/agire su tutto senza il
  filtro di ownership altrimenti applicato al volontario.
  **Nuovo concetto**: "superadmin" non esiste oggi come ruolo nell'app
  (verificato: solo `admin`/`volunteer`/`organizer` in uso) — collegato
  all'idea di una futura pagina "super admin" già emersa nella
  discussione su `ir-email-templates-versioned`, non ancora una decisione
  strutturata su come autenticare/autorizzare questo livello.
  **Aggiornamento (2026-09-06, dopo il ripensamento architetturale)**:
  l'eccezione si realizza con un ruolo IAM nativo di Google Cloud Storage
  scoped al bucket/prefix degli allegati, non più con permessi di
  condivisione Drive — vedi sezione "Ripensamento architetturale" sopra.
- **Logging e ciclo di vita del download** (2026-09-06): si traccia solo
  l'evento di **emissione della signed URL** (via `logSecurityEvent`,
  convenzione già esistente nel repo) — non l'inizio né il completamento
  del download effettivo. Una volta emessa l'URL, se e quando l'utente
  scarica davvero il file non è tracciato né rilevante: nessun trigger
  GCS per "download completato" da collegare.
- **TTL della signed URL**: tenuto volutamente basso — il flusso atteso è
  "click sull'allegato → URL generata al momento → download immediato",
  non un link da conservare o riutilizzare più tardi.
- **Dimensione file e resumable upload/download**: nessun supporto
  previsto per allegati oltre i 20-50MB — di conseguenza non serve
  gestire pause/resume né una signed URL con una lease lunga. Un limite
  esplicito in questo ordine di grandezza va imposto lato Cloud Function
  al momento dell'emissione della URL di upload.
- **Tipo file, quota, virus-scan** (2026-09-06): qualunque tipo di file è
  ammesso, nessuna quota per entità/totale per ora, nessuna scansione
  antivirus prevista.
- **Modello dati dell'entità Attachment** (2026-09-06): oltre a
  `entityType`/`entityId` (riferimento all'entità proprietaria, già
  previsto dallo studio) e `uploadedBy` (owner, già deciso per l'RBAC di
  modifica/eliminazione), l'entità include: nome file, descrizione
  (**obbligatoria**), note (libere, distinte dalla descrizione),
  categoria (per presentare gli allegati raggruppati in UI — da chiarire
  se riusa il `category` opaco già esistente sul core Organizer o è un
  campo a sé, stesso punto di attenzione già sollevato per
  `ir-special-projects-initiatives`), url/path sul bucket, dimensione
  (per la presentazione a schermo) ed estensione (dedotta
  automaticamente dal nome file, non un campo inserito dall'utente).

## Domande aperte per lo studio

- **Storage backend**: risolto — Cloud Storage nativo (Option A
  ridisegnata: Cloud Function per RBAC + signed URL, trasferimento byte
  diretto client↔GCS), non più Google Drive. Vedi "Ripensamento
  architetturale" sopra.
- **Vincoli tecnici**: risolti sopra (dimensione massima ~20-50MB, TTL
  signed URL basso, tipo file libero, nessuna quota, nessun virus-scan).
- **Modello dati Firestore**: subcollection dedicata su ciascuna entità
  (es. `deviceRequests/{id}/attachments/{attachmentId}`) vs. collection di
  primo livello con riferimento all'entità proprietaria (pattern già
  scelto per `checklistItems`, EA-137) — il campo elenco sopra assume il
  secondo pattern (coerente con "capability di base" riusabile), ma la
  scelta tra i due resta da confermare esplicitamente in Story.
- **Sicurezza dei file**: qualunque sia il backend, l'accesso deve
  replicare lo stesso perimetro RBAC di Firestore (staff-only) — nessun
  link/path indovinabile, nessun accesso anonimo diretto ai file.
- **Superficie della capability di base**: quali operazioni espone al
  consumer (upload/list/update-description/delete) e con quale contratto,
  in modo che agganciare un nuovo dominio (es. progetti speciali) resti
  davvero un'integrazione leggera come da obiettivo della sequenza sopra.
- **Meccanismo dell'eccezione superadmin**: risolto (2026-09-06).
  `superadmin` è un ruolo che si affianca ad `admin` (non lo sostituisce),
  **non concedibile da UI/GUI**: l'assegnazione IAM su GCS avviene a mano
  direttamente in console Firebase/GCP da parte dell'operatore stesso
  (oggi l'unico superadmin è l'operatore in prima persona) — nessun
  meccanismo applicativo di gestione dell'elenco da costruire, è
  amministrazione manuale fuori dall'app, coerente con l'idea di
  eccezione riservata a pochissime persone.

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
