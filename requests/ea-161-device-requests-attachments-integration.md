# Story: Integrazione allegati su device-requests + refactor a tab di RequestDetail/VolunteerRequestDetail

## Stato attuale

La capability di base "Allegati" (Epic EA-161, Story EA-162→EA-167) è
completa e mergiata: collection `attachments/{attachmentId}` (dati
completi) + subcollection indice `{entityCollectionPath}/{entityId}/attachments/{attachmentId}`,
5 Cloud Function generiche (`uploadAttachment`, `listAttachments`,
`downloadAttachment`, `updateAttachmentDescription`, `deleteAttachment`)
con RBAC staff-only generico (admin+volontario, ownership per
modifica/eliminazione). Nessun consumer di dominio esiste ancora — questa
Story è esplicitamente il "secondo consumer/integrazione, step 2" già
previsto dalla request originale (`docs/implementation-requests/cross-entity-attachments-request.md`).

`enable-device/src/pages/admin/requests/RequestDetail.tsx` (1782 righe) e
`enable-device/src/pages/volunteer/VolunteerRequestDetail.tsx` (340 righe)
sono oggi una sequenza lineare di Panel PrimeReact, senza alcuna
strutturazione a tab. `RequestDetail.tsx` contiene, in ordine: banner
"Richiesta da validare" (condizionale su `status === "inviata"`), Panel
"Dettagli richiesta", "Dati richiedente (privati)", "Dati richiedente
(pubblici)", "Indirizzo di spedizione", "Liberatorie familiari",
"Checklist di fabbricazione", "Ultimo evento", "Cronologia gestione
richiesta" (usa il componente `RequestTimeline` esistente). La
possibilità di aggiungere un evento/nota alla cronologia **esiste già**
(dialog "Aggiungi nota", `handleAddNote`, chiama `changeStatus` con lo
stesso `status` e una `note`) — non va costruita da zero, solo
riorganizzata nella tab corretta.

`VolunteerRequestDetail.tsx` ha la stessa struttura meno "Liberatorie
familiari" (mai mostrata al volontario, RBAC invariato).

Il layer `device-requests` ha già un pattern di wrapping consolidato per
delegare al core Organizer con RBAC più stretto di quello generico:
`addDeviceRequestChecklistItem.ts` verifica accesso via
`resolveDeviceRequestChecklistAccess` (admin, o volontario presente in
`assignedVolunteers` della `deviceRequest`) e poi delega chiamando
`addChecklistItem.run({...request, data: {...}})` — la Cloud Function
generica invocata direttamente come funzione, non via HTTP.

## Decisioni confermate dall'operatore (2026-09-07)

- **Pattern di integrazione**: stesso wrapping del layer checklist. Nuovo
  modulo `functions/backend/src/device-requests/deviceRequestAttachmentAccess.ts`
  con una funzione `resolveDeviceRequestAttachmentAccess(db, uid, requestId)`
  (stesso RBAC di `resolveDeviceRequestChecklistAccess`: admin o volontario
  in `assignedVolunteers`), usata da 5 nuove Cloud Function wrapper:
  `uploadDeviceRequestAttachment`, `listDeviceRequestAttachments`,
  `downloadDeviceRequestAttachment`, `updateDeviceRequestAttachmentDescription`,
  `deleteDeviceRequestAttachment`. Ognuna verifica RBAC, poi delega alla
  Cloud Function generica corrispondente via `.run({...request, data: {...}})`.
  Per le 4 funzioni che operano su un `attachmentId` già esistente
  (list/download/update/delete), il wrapper richiede comunque un
  `requestId` esplicito dal chiamante e verifica che l'allegato risolto
  (via `getAttachmentById`) abbia `entityType === "deviceRequest"` ed
  `entityId === requestId` — stesso principio di
  `checklistIds.includes(checklistId)` nel pattern checklist, per
  impedire che un volontario assegnato alla richiesta A usi il suo
  `requestId` per agire su un allegato in realtà appartenente alla
  richiesta B.
  L'RBAC generico della Cloud Function di base (staff-only) resta
  comunque in vigore internamente: il wrapper aggiunge un vincolo più
  stretto, non lo sostituisce.
- **Sincronizzazione lato server**: nessun meccanismo nuovo da costruire.
  La subcollection indice `deviceRequests/{requestId}/attachments/{attachmentId}`
  già scritta da `createAttachment`/`deleteAttachmentRecord` (capability
  di base) è già la sincronizzazione richiesta — il wrapper si limita a
  passare `entityCollectionPath: "deviceRequests"` alla funzione generica.
- **`updatedAt`**: campo mancante nel modello dati di base (non deciso
  esplicitamente nella Story EA-166). Aggiungere `updatedAt` a
  `AttachmentDocumentFields`/`AttachmentRecord`, valorizzato con
  `FieldValue.serverTimestamp()` sia da `createAttachment` (uguale a
  `createdAt` all'origine) sia da `updateAttachmentFields` (ad ogni
  modifica di descrizione/note). Campo generico della capability di base,
  non specifico di device-requests.
- **Filtro per categoria** nell'elenco allegati lato UI (client-side sui
  risultati di `listDeviceRequestAttachments`, nessuna modifica alla
  Cloud Function generica `listAttachments` che già restituisce
  `category`).
- **Refactor a tab** di `RequestDetail.tsx` e `VolunteerRequestDetail.tsx`
  (componente `TabView`/`TabPanel` di PrimeReact, già usato altrove nel
  repo), riorganizzando le sezioni esistenti senza cambiarne la logica
  interna:
  - **Tab "Dati generali"**: Dettagli richiesta, Dati richiedente
    (privati/pubblici su `RequestDetail.tsx`; dati richiedente su
    `VolunteerRequestDetail.tsx`), Indirizzo di spedizione, Ultimo
    evento, Cronologia gestione richiesta (con l'aggiunta-evento già
    esistente).
  - **Tab "Fabbricazione/Liberatorie"**: Checklist di fabbricazione (+
    Liberatorie familiari, solo su `RequestDetail.tsx`, RBAC admin
    invariato).
  - **Tab "Allegati"** (nuova): elenco (con filtro categoria), upload,
    download, modifica descrizione/note, eliminazione — usando i 5
    wrapper device-requests sopra.
  - Il banner "Richiesta da validare" (condizionale) resta **fuori**
    dalle tab, sopra di esse: è un'azione bloccante pre-contenuto, non
    una sezione di contenuto.

## Domini coinvolti

- `device-requests` (5 nuove Cloud Function wrapper, nuovo modulo RBAC,
  refactor `RequestDetail.tsx`/`VolunteerRequestDetail.tsx`)
- `attachments` (solo aggiunta del campo generico `updatedAt`, nessun
  altro cambiamento alla capability di base)

## Origine

Richiesta esplicita dell'operatore in conversazione, 2026-09-07, come
step 2 già previsto da `ir-cross-entity-attachments` all'atto della sua
risequenziazione (2026-09-06): "quando si arriverà a implementare
device-requests, l'aggancio agli allegati dovrebbe essere una semplice
integrazione a una capability già pronta". Creata come Story diretta
tramite `create-story` (non attraverso `plan-stories`) per implementazione
diretta fuori dal ciclo `run-epic`/panel review automatica, su richiesta
esplicita dell'operatore.
