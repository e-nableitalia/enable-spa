# Riduzione degli stati interni di changeStatus a macro-stati (device-lifecycle)

## Stato attuale

`functions/backend/src/device/changeStatus.ts` governa oggi 19 stati
interni distinti su `deviceRequests/{id}.status`, sparsi tra tre gruppi
non centralizzati in un'unica costante:

- **Triage (8)**: `inviata`, `validata`, `famiglia contattata`,
  `definizione richiesta`, `valutazione fattibilità`, `attesa
  volontario`, `followup famiglia ko`, `followup famiglia troppo
  piccolo`
- **Produzione granulare (8, già isolati in `PRODUCTION_LIFECYCLE_STATUSES`,
  `functions/backend/src/utils/productionLifecycle.ts`, Story EA-107)**:
  `scelta device e dimensionamento`, `personalizzazione`, `attesa
  materiali`, `fabbricazione`, `fitting`, `pronta per spedizione`,
  `spedita`, `followup famiglia`
- **Terminali/speciali (3)**: `completata`, `annullata`, `standby`

Questi 19 stati collassano oggi in 5 gruppi di `publicStatus`
(`mapToPublicStatus.ts`): `da validare` (solo `inviata`), `da gestire`
(4 stati di triage + fallback di default), `fabbricazione in corso`
(gli 8 stati di produzione), `completati` (`completata`), `annullate /
non completabili` (4 stati). Le 5 transizioni RBAC consentite ai
volontari (`isAllowedVolunteerTransition`,
`utils/volunteerTransitions.ts`) ricadono tutte interamente dentro gli
8 stati di produzione granulare.

## Origine e motivazione

L'Epic Jira **EA-2** ("Refactoring gestione macro-stato richiesta
dispositivo") dichiara esplicitamente questo obiettivo: "ridurre i 19
stati interni a un insieme ristretto di stati macro... delegando il
tracciamento granulare del processo di fabbricazione al modulo
Organizer". L'Epic è marcata **Done** su Jira, ma le 6 Story completate
sotto di essa (EA-102→EA-107) sono **lavoro preparatorio** — isolamento
RBAC, notifiche, event sourcing, centralizzazione dei soli 8 stati di
produzione in un modulo dedicato (EA-107, testualmente "preparazione
alla delega Organizer") — non la riduzione stessa. L'obiettivo
principale dichiarato dall'Epic non risulta implementato.

La stessa Epic segnalava una dipendenza di sequenza: "si raccomanda di
completare (o avere in stato avanzato) `device-organizer-integration`
[EA-108] prima di attivare la fase Story di questa Epic". EA-108 è ora
**completo** (5/5 Story Done), e la todo-list personale cross-checklist
(Epic EA-134, opt-e di `ss-user-todo-list`) più la pulizia del modello
item (Epic EA-135) sono anch'esse complete — l'infrastruttura Organizer
propedeutica a questa delega (collection `checklistItems` di primo
livello, `listMyChecklistItems`, assignee promosso a uid reale) è
quindi pronta. Il blocco di sequenza dichiarato dall'Epic è caduto.

## Problema

Decidere e realizzare la riduzione effettiva: quali degli 11 stati
"macro" genuini del ciclo richiesta restano stati di
`deviceRequests.status`, come gli 8 stati di produzione granulare
(oggi ancora stati di `changeStatus`, sia pure isolati in una costante
dedicata) vengono sostituiti da attività/item tracciati nella checklist
Organizer collegata alla `deviceRequest` (EA-108), e come le 5
transizioni RBAC oggi codificate in `isAllowedVolunteerTransition`
sopravvivono (probabilmente come regole di completamento/assegnazione
di item di checklist, non più come transizioni di `status`).

## Vincoli noti da rispettare (dalla descrizione originale di EA-2)

- **5 gruppi di `publicStatus` invariati** nell'interfaccia pubblica
  (`da validare`, `da gestire`, `fabbricazione in corso`, `completati`,
  `annullate / non completabili`) — nessun comportamento visibile a
  admin/volontari/richiedenti deve cambiare per questo studio, anche se
  la rappresentazione interna cambia.
- **Event sourcing invariato**: ogni transizione continua a produrre un
  documento in `deviceRequests/{id}/events/{eventId}` con la stessa
  struttura.
- **Sincronizzazione `publicDeviceRequests` invariata**: ogni cambio di
  `status` continua ad aggiornare atomicamente la proiezione pubblica.
- **Notifiche opzionali post-transizione invariate** nella semantica.
- Fuori scope: cambiamenti a validazione/anonimizzazione
  (`cap-request-validation`), Security Rules, infrastruttura di
  notifica, nuovi stati pubblici, UI volontario (`/volunteer/*`) oltre
  a quanto strettamente necessario per riflettere il nuovo modello.

## Domande aperte per lo studio

- Gli 8 stati di produzione granulare diventano item di una checklist
  template standard (istanziata automaticamente alla creazione della
  deviceRequest, come già avviene per EA-108/EA-109), o restano un
  sotto-stato di `deviceRequests.status` finché la checklist non è
  completa al 100%? Cioè: `status` collassa a un singolo valore
  `fabbricazione in corso` durante tutta la fase di produzione (con il
  dettaglio granulare *solo* nella checklist), o mantiene comunque un
  marcatore intermedio?
- Le 5 transizioni RBAC volontario diventano regole di
  assegnazione/completamento sugli item della checklist (RBAC già
  esistente su `updateDeviceRequestChecklistItem`, Story EA-108), o va
  preservato un controllo equivalente altrove?
- Come si inizializza la checklist di fabbricazione per una
  `deviceRequest`: automaticamente alla transizione verso
  `fabbricazione in corso` (riusando `createDeviceRequestChecklist`,
  EA-108), o è già un passo manuale dell'admin/volontario oggi?
- I 3 stati terminali/speciali (`completata`, `annullata`, `standby`)
  restano stati di `deviceRequests.status` senza modifiche: da
  confermare che nessuno di questi debba invece diventare una
  condizione derivata dallo stato di completezza della checklist
  (es. `completata` quando la checklist è al 100%).
- Compatibilità con richieste già in produzione: a differenza dello
  studio `ss-user-todo-list` (dove non c'erano dati reali da
  migrare), qui `deviceRequests` con `status` già valorizzato tra gli
  8 stati di produzione granulare *esistono* in produzione — lo studio
  deve trattare esplicitamente la migrazione/coesistenza, non
  assumerla risolvibile per cancellazione dei dati di test.

## Domini coinvolti

- `device-requests` (`changeStatus.ts`, `mapToPublicStatus.ts`,
  `productionLifecycle.ts`, `isAllowedVolunteerTransition`,
  `RequestDetail.tsx` e viste admin/volontario correlate)
- `process-organizer-core` (consumer della checklist già esistente via
  EA-108, nessun cambiamento al core stesso atteso ma da confermare)

## Origine

Emerso in conversazione con il supervisor a valle del completamento
delle Epic EA-134/EA-135 (todo-list personale e pulizia del modello
item Organizer), sessione 2026-08-06: l'operatore ha richiamato
l'obiettivo originale di EA-2 (riduzione stati, delega del dettaglio di
fabbricazione all'Organizer), riconoscendo che le Story finora
completate sotto EA-2 erano solo preparatorie e che il blocco di
sequenza verso EA-108 è ora caduto.
