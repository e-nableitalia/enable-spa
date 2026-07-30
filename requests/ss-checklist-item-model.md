# Evoluzione del modello item della checklist Organizer

## Problema

Validando lo staging (`enableitalia-staging`) è emerso che il modello attuale
di item checklist (`functions/backend/src/organizer/*`, campi `title`,
`status` a 4 valori fissi, `assignee` testo libero, `quantity`, `notes`) e
la sua rappresentazione in `enable-device/src/components/checklist/ChecklistPanel.tsx`
sono adeguati per item "materiale da procurare" ma non per item "attività
da svolgere":

- `quantity` non ha senso per un'attività, ma è mostrato per ogni item
  indipendentemente da cosa rappresenti.
- `assignee` è oggi un campo di testo libero — di fatto inutilizzabile,
  serve un riferimento reale a un volontario (dropdown), non testo
  arbitrario.
- Nella UI attuale lo stato dell'item sembra bloccato su `"Assegnare"`
  (lo stato iniziale) e non modificabile, sia quando l'assegnatario è
  valorizzato sia quando non lo è — va sempre permesso il cambio di
  stato.
- **Bug di correttezza confermato** in
  `functions/backend/src/organizer/checklistCompleteness.ts`
  (`hasProgressedPastInitialStatus`): un item è considerato "completo"
  se `status !== "Assegnare"`, quindi anche `"Da iniziare"` e
  `"In corso"` (esplicitamente NON completati) superano il gate. Il
  gate documentato come riferimento per `canConfirm` (sblocco di
  decisioni esterne, es. conferma fabbricazione) è quindi troppo
  ottimistico. Andrebbe invece richiesto `status === "Completata"`
  come unico stato che significa "fatto".

## Direzione proposta (da validare/affinare nello studio)

Introdurre un discriminante `type` sull'item, con tre varianti:

1. **`boolean`**: titolo/descrizione, note, assegnatario (volontario),
   flag todo/done. Nessuno stato a 4 valori, nessuna quantità.
2. **`generic`**: mantiene lo stato a 4 valori attuale
   (`Assegnare`/`Da iniziare`/`In corso`/`Completata`). In
   presentazione convive con un checkbox sincronizzato
   bidirezionalmente con lo stato: flag checkbox → stato =
   `"Completata"`; stato diverso da `"Completata"` → checkbox
   sbottonato; impostare lo stato aggiorna di conseguenza il checkbox
   e viceversa.
3. **`numeric`**: come `generic`, con l'aggiunta del campo `quantity`
   (mostrato solo per questo tipo).

Ulteriori vincoli emersi in conversazione:

- L'assegnatario deve diventare una selezione (dropdown) sui volontari
  esistenti, non testo libero.
- Il cambio di stato/assegnatario dall'item non deve mai essere
  bloccato dall'interfaccia, indipendentemente dal valore attuale dei
  due campi.
- Il fix del gate di completezza (`status === "Completata"`) è
  incluso in questo scope, anche se concettualmente è una correzione
  di bug indipendente dal resto.

## Esplicitamente fuori scope

- **Checklist multiple per singola `deviceRequest`** — cambio di
  cardinalità del modello (oggi 1:1 tramite `deviceRequest.checklistId`),
  di scala diversa da questo studio. Tracciata separatamente come
  implementation request:
  `docs/implementation-requests/multi-checklist-per-device-request.md`
  (inventory id `ir-multi-checklist-per-device-request`).

## Impatti noti da esplorare nello studio

- Migrazione/retrocompatibilità: le checklist già create in produzione
  hanno tutti gli item nella forma attuale (nessun campo `type`).
- Consumer a valle da rivedere: `ChecklistPanel.tsx`,
  `getChecklistShareStatus` (espone solo `percentComplete`, il calcolo
  di completamento dipende dal fix del gate e dalla logica per-tipo),
  `cloneDeviceRequestChecklist`/`cloneChecklist` (clonazione item deve
  preservare/adattare il `type`).
- Dominio di riferimento: `process-organizer-core` (core, EA-3) e
  `device-requests` (consumer/integrazione, EA-108).
