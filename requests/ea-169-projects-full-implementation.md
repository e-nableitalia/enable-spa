# Story: Implementazione completa Progetti Speciali e Iniziative

## Stato attuale

L'Epic EA-169 (Pipeline Stage: Approved) e lo studio deciso
`ss-special-projects-initiatives` (opt-b-checklist-ids-array) hanno
stabilito il modello: nuova entità `projects/{projectId}` (nome interno
"project"), che riusa senza modifiche il core Organizer già Done (EA-3)
per le checklist collegate.

## Modello dati

`projects/{projectId}`:
- `title: string`, `description: string`
- `projectType: string` — valori iniziali `progetto`/`iniziativa`/`evento`,
  elenco estensibile (non un enum chiuso lato codice)
- `status: "new" | "active" | "standby" | "archived" | "closed"`
- `checklists: {checklistId: string, label: string}[]`
- `createdBy: string` (uid), `createdAt`, `updatedAt`

`projects/{projectId}/events/{eventId}` (stesso pattern di
`deviceRequests/{id}/events`): `fromStatus`, `toStatus`, `note`,
`createdBy`, `timestamp`. Una "nota" senza cambio di stato reale è
modellata come evento con `fromStatus === toStatus`, stesso trucco già
usato da `RequestDetail.handleAddNote`.

## Regole di stato (decisione operatore, non negoziabili)

- `archived`/`closed` sono terminali: **nessuna modifica di alcun tipo**
  è più permessa (nemmeno una nota, nemmeno un cambio di stato) una volta
  raggiunti.
- In `standby`: **solo l'aggiunta di una nota** è permessa (via
  `changeProjectStatus` con `newStatus === status` corrente); modifiche a
  titolo/descrizione, creazione/modifica/rimozione di checklist e dei
  loro item sono bloccate. Le transizioni di stato vere e proprie (per
  uscire da `standby` verso `active`/`archived`/`closed`) restano
  possibili — altrimenti `standby` sarebbe un vicolo cieco: l'unico modo
  di uscirne è proprio la transizione di stato, che non è "una modifica
  al contenuto" nello stesso senso di editare titolo/checklist.
- In `new`/`active`: tutte le operazioni sono permesse.

## RBAC

- **Creazione progetto**: solo admin.
- **Modifica progetto** (titolo/descrizione), **creazione/eliminazione
  checklist**: solo admin (stessa cerchia della creazione).
- **Assegnazione/gestione item di checklist**: admin **e** volontari
  (nessuna restrizione di "volontario assegnato a questo progetto" — a
  differenza di `device-requests`, qui non esiste un concetto di
  `assignedVolunteers` per-progetto: qualunque volontario attivo può
  operare su qualunque progetto non terminale/non in standby).
- **Lettura** (progetto, checklist, cronologia): qualunque admin o
  volontario, sempre permessa indipendentemente dallo stato (leggere non
  è una "modifica").
- **Cambio di stato**: solo admin.

## Cloud Function da implementare (nuovo modulo `functions/backend/src/projects/`)

Layer di dominio "projects" che delega al core Organizer via `.run()`
esattamente come il layer `device-requests` fa oggi per le checklist
(`addDeviceRequestChecklistItem` → `addChecklistItem`, ecc.) — stesso
pattern, non una logica nuova:

1. `createProject` — admin-only. `{title, description, projectType}` →
   crea il documento con `status: "new"`, `checklists: []`.
2. `listProjects` — staff-only (admin+volontario). Elenco completo, filtro
   per `projectType` lato client (stesso principio del filtro categoria
   già scelto per gli allegati).
3. `updateProject` — admin-only. `{projectId, title?, description?}`,
   bloccato fuori da `new`/`active`.
4. `changeProjectStatus` — admin-only. `{projectId, newStatus, note}`,
   scrive un evento e aggiorna lo stato; bloccato del tutto se lo stato
   corrente è `archived`/`closed`.
5. `createProjectChecklist` — admin-only, bloccato fuori da `new`/`active`.
   `{projectId, label, title, templateId?}` → delega a
   `createChecklist`/`createChecklistFromTemplate` (categoria =
   `projectType` del progetto, stesso principio di device-requests che usa
   `devicetype`), aggiunge `{checklistId, label}` a `checklists`.
6. `deleteProjectChecklist` — admin-only, bloccato fuori da `new`/`active`.
   Rimuove l'item dall'array e la checklist (mirror di
   `deleteDeviceRequestChecklist`).
7. `addProjectChecklistItem` / `updateProjectChecklistItem` /
   `removeProjectChecklistItem` — admin+volontario, bloccati fuori da
   `new`/`active`. Verificano che il `checklistId` appartenga a
   `projects/{projectId}.checklists` (stesso principio di
   `checklistIds.includes(checklistId)`), poi delegano al core.
8. `getProjectChecklist` / `getProjectChecklistCompleteness` — lettura,
   staff-only, sempre permesse indipendentemente dallo stato.
9. `listAssignableProjectUsers` — staff-only. Ritorna tutti gli admin più
   tutti i volontari attivi (nessuna restrizione per-progetto, a
   differenza dell'equivalente device-requests che combina
   `assignedVolunteers` + admin).

Convenzioni trasversali da rispettare: `logSecurityEvent` su ogni
Cloud Function (inizio/fine/errori), RBAC in codice TypeScript, stesso
stile di commit/test del resto del repo.

## Frontend

- Pagina admin **elenco progetti** (nuova rotta, es.
  `/admin/projects`), con filtro per `projectType` e pulsante "Crea
  progetto".
- Pagina admin **dettaglio progetto**, con: dati generali (titolo,
  descrizione, tipo, stato, editabili se admin e stato lo permette),
  cronologia/note (riuso del componente `RequestTimeline` già esistente,
  generico), gestione checklist (nuovo componente `ProjectChecklists`,
  stessa struttura a tab di `DeviceRequestChecklists` ma verso le Cloud
  Function di questo dominio — **non riusare/modificare
  `DeviceRequestChecklists`**, che resta specifico di device-requests e
  già in produzione, per non introdurre rischio su codice esistente).
- Nessuna integrazione con gli Allegati in questa Story (dichiarata fuori
  scope dall'Epic stessa — passo successivo separato).

## Fuori scope (esplicito)

- Integrazione con la capability "Allegati".
- Qualunque modifica al core `process-organizer-core` (riuso puro, come
  da studio deciso).
- Notifiche (email/Telegram) sui cambi di stato dei progetti — non
  richieste, a differenza di `deviceRequests`.

## Source

- Epic: EA-169
- solution_study: `docs/solution-studies/ss-special-projects-initiatives.json`
- request_ref: `docs/implementation-requests/special-projects-initiatives-request.md`

## Origine

Richiesta esplicita dell'operatore, 2026-09-07: implementazione diretta
(no `plan-stories`/`run-epic`), un'unica Story per tracciare il lavoro,
verifica finale tramite `close-story --auto` (policy gate + panel review
correttezza/convenzioni/adversarial/qualità test) invece di cicli
Story-per-Story, per ottimizzare l'uso delle sessioni.
