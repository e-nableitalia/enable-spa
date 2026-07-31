# Findings

Elenco progressivo di bug preesistenti, comportamenti anomali o ambiguita' non documentate scoperte durante le sessioni di deep-dive del cognitive workspace. Non correggere il comportamento segnalato in questo file di propria iniziativa: la correzione richiede decisione umana esplicita, salvo diversa indicazione.

## F-1: `deleteChecklist` verifica un campo `createdBy` che nessuna funzione del core Organizer scrive mai

- **Descrizione**: `deleteChecklist` consente l'eliminazione di una checklist se `role === 'admin'` oppure se `data.createdBy === uid` (il chiamante e' il "creatore" della checklist). Tuttavia nessuna delle funzioni di creazione del core Organizer (`createChecklist`, `createChecklistFromTemplate`, `cloneChecklist`) scrive mai il campo `createdBy` sul documento `checklists/{id}` al momento della creazione. Di conseguenza, in produzione `data.createdBy` e' sempre `undefined` per qualunque checklist creata da questo modulo, e non potra' mai coincidere con un `uid` autenticato valido: il ramo "il creatore puo' eliminare la propria checklist" e' codice morto, e nella pratica **solo un admin puo' eliminare una checklist**, indipendentemente da chi l'abbia creata.
- **Evidenza**:
  - `functions/backend/src/organizer/deleteChecklist.ts:39` — `if (role !== "admin" && data.createdBy !== uid)`
  - `functions/backend/src/organizer/createChecklist.ts:123-128` — `checklistRef.set({...})` senza `createdBy`
  - `functions/backend/src/organizer/createChecklistFromTemplate.ts:124-130` — idem
  - `functions/backend/src/organizer/cloneChecklist.ts:133-139` — idem
  - `functions/backend/src/organizer/deleteChecklist.test.ts:71` — il test imposta `createdBy` manualmente sul mock del documento, mascherando l'assenza del campo nel codice di produzione
- **Story/PR/sessione di provenienza**: Epic Jira EA-3 "Organizer Core" (riferimento da `docs/cognitive-workspace/discover-context.json`, non verificabile via API Jira in questa sessione per permessi mancanti); rilevato durante deep-dive del dominio `process-organizer-core`, sessione 2026-07-28.
- **Stato**: risolto (Task Jira EA-120, 2026-07-28). `createChecklist.ts`, `createChecklistFromTemplate.ts` e `cloneChecklist.ts` ora scrivono `createdBy: uid` sul documento `checklists/{id}` al momento della creazione. `deleteChecklist.test.ts` non imposta più `createdBy` a mano sul mock: verifica il ramo "creatore" creando la checklist tramite `createChecklist.run(...)` e controllando che `deleteChecklist` legga davvero il valore scritto da quest'ultima.

## F-2: Copertura incoerente di `logSecurityEvent` tra le Cloud Function del core Organizer

- **Descrizione**: la convenzione di repository documentata ("Ogni Cloud Function deve loggare inizio, fine ed errori in securityLogs via `logSecurityEvent`", vedi `docs/cognitive-workspace/discover-context.json` -> `conventions.security_logging`) non e' applicata uniformemente nel modulo Organizer. `updateChecklist`, `deleteChecklist`, `addChecklistItem`, `updateChecklistItem`, `removeChecklistItem` chiamano `logSecurityEvent` sia su successo sia su fallimento; `createChecklist`, `createChecklistFromTemplate`, `cloneChecklist`, `getChecklist`, `listTemplates`, `createTemplate`, `updateTemplate`, `deleteTemplate`, `getChecklistCompleteness` non lo fanno mai (usano solo `console.log`/`console.error`).
- **Evidenza**:
  - Con `logSecurityEvent`: `functions/backend/src/organizer/updateChecklist.ts`, `deleteChecklist.ts`, `addChecklistItem.ts`, `updateChecklistItem.ts`, `removeChecklistItem.ts`
  - Senza `logSecurityEvent`: `functions/backend/src/organizer/createChecklist.ts`, `createChecklistFromTemplate.ts`, `cloneChecklist.ts`, `getChecklist.ts`, `listTemplates.ts`, `createTemplate.ts`, `updateTemplate.ts`, `deleteTemplate.ts`, `getChecklistCompleteness.ts`
- **Story/PR/sessione di provenienza**: Epic Jira EA-3 "Organizer Core"; rilevato durante deep-dive del dominio `process-organizer-core`, sessione 2026-07-28.
- **Stato**: risolto (Task Jira EA-120, 2026-07-28). Le 9 funzioni prive di copertura ora chiamano `logSecurityEvent` sia su successo sia su fallimento, con lo stesso pattern di `updateChecklist.ts`/`deleteChecklist.ts` (azione `<verbo>_<risorsa>` in caso di successo, `<verbo>_<risorsa>_failed` in caso di fallimento). `getChecklist.ts` e `getChecklistCompleteness.ts` non avevano un blocco `try/catch`: è stato introdotto per poter loggare l'esito, senza cambiare il comportamento delle validazioni esistenti.

## F-3: `createTemplate.ts` era privo di test automatici prima di EA-120

- **Descrizione**: a differenza delle altre Cloud Function del core Organizer, `createTemplate.ts` non aveva un file `createTemplate.test.ts`. Non è chiaro se si tratti di una dimenticanza o di una scelta deliberata non documentata.
- **Evidenza**: assenza di `functions/backend/src/organizer/createTemplate.test.ts` prima di questa Story (verificato con `ls functions/backend/src/organizer/*.test.ts`).
- **Story/PR/sessione di provenienza**: rilevato durante l'implementazione del Task Jira EA-120 (F-2), sessione 2026-07-28. Un file di test minimo è stato aggiunto in questa stessa Story per coprire il nuovo comportamento `logSecurityEvent`, ma non è stata condotta una revisione sistematica della copertura di test pre-esistente del modulo Organizer.
- **Stato**: preservato as-is (test minimi aggiunti per lo scope di EA-120; una revisione più ampia della copertura di test del modulo Organizer è fuori scope qui). Proposta: task Jira nell'Epic EA-3 per audit della copertura di test del core Organizer, riferimento F-3.

## F-4: Il dropdown di stato item in `ChecklistPanel.tsx` non è mai disabilitato, in contraddizione con quanto riportato nella richiesta `ss-checklist-item-model`

- **Descrizione**: la richiesta di implementazione (validazione su staging `enableitalia-staging`) afferma che "lo stato dell'item sembra bloccato su 'Assegnare' ... e non modificabile, sia quando l'assegnatario è valorizzato sia quando non lo è". La lettura del codice attuale non conferma questo comportamento: la colonna "Stato" di `ChecklistPanel.tsx` usa un `Dropdown` PrimeReact senza alcuna prop `disabled`, sempre editabile indipendentemente dal valore di `assignee`. La cronologia git del file (dall'introduzione in EA-111 fino a EA-113) non mostra mai l'aggiunta di una prop `disabled` su questo componente.
- **Evidenza**:
  - `enable-device/src/components/checklist/ChecklistPanel.tsx` — colonna "Stato", componente `Dropdown` privo di `disabled`
  - `git log -p --follow -- enable-device/src/components/checklist/ChecklistPanel.tsx | grep disabled` — le uniche occorrenze di `disabled` riguardano i pulsanti "Salva" (`disabled={!isDirty(item.id)}`) e "Aggiungi" (`disabled={!newItem.title.trim()}`), mai il Dropdown di stato
- **Story/PR/sessione di provenienza**: rilevato durante il grounding dello studio di soluzione `ss-checklist-item-model`, sessione 2026-07-30.
- **Stato**: da decidere. Non è chiaro se l'osservazione in staging si riferisse a una build diversa, a un altro componente (es. la vista di sola condivisione EA-113, che però non espone comunque un editor di stato), o a una percezione UX non riconducibile a un blocco effettivo del controllo. Da chiarire con chi ha validato lo staging prima di assumere che questo punto richieda un fix separato dall'evoluzione del modello item.

## F-5: Il campo `quantity` viene scritto incondizionatamente da tutte le funzioni di creazione/clonazione item del core Organizer: il ramo "quantity irrilevante" del gate di completezza non è mai esercitato in produzione

- **Descrizione**: `checklistCompleteness.ts` (`hasQuantityWhenRelevant`) è progettato per trattare un item come "senza vincolo di quantità" quando la chiave `quantity` è del tutto assente dall'oggetto, distinguendola esplicitamente dal caso "chiave presente con valore `null`" (che invece richiede valorizzazione). Nella pratica, però, **tutte** le funzioni che producono un item (`createChecklist.normalizeInitialItem`, `addChecklistItem`, `createChecklistFromTemplate`, `cloneChecklist.cloneSourceItem`) scrivono sempre la chiave `quantity` (con `?? null` come fallback), senza mai ometterla. Di conseguenza, in produzione ogni item ha sempre la chiave `quantity` presente, e il ramo "quantity irrilevante" del gate non si attiva mai: qualunque item, indipendentemente dalla sua natura (attività vs materiale), è oggi trattato dal gate come se la quantità fosse sempre rilevante.
- **Evidenza**:
  - `functions/backend/src/organizer/createChecklist.ts:71` — `quantity: (quantity as number | undefined) ?? null` (sempre presente)
  - `functions/backend/src/organizer/addChecklistItem.ts:79` — `quantity: quantity ?? null`
  - `functions/backend/src/organizer/createChecklistFromTemplate.ts:48` — `quantity` sempre presente
  - `functions/backend/src/organizer/cloneChecklist.ts:44-52` — `quantity` sempre presente
  - `functions/backend/src/organizer/checklistCompleteness.ts` — `hasQuantityWhenRelevant` distingue esplicitamente chiave-assente da chiave-null, ramo mai raggiunto dai produttori di item sopra elencati
- **Story/PR/sessione di provenienza**: rilevato durante il grounding dello studio di soluzione `ss-checklist-item-model`, sessione 2026-07-30. Rilevante per lo studio stesso: qualunque opzione che assuma "un item può oggi non avere quantità" come stato raggiungibile deve prima correggere queste 4 funzioni perché omettano davvero la chiave quando non fornita.
- **Stato**: da decidere. Proposta: task Jira nell'Epic EA-3, da valutare insieme alla decisione sullo studio `ss-checklist-item-model` (la correzione ha senso solo nel contesto di quale opzione viene scelta, altrimenti è codice morto che nessun consumer esercita oggi).

## F-6: Lo shorthand a stringa per gli item iniziali di `createChecklist` diventa irraggiungibile dopo l'introduzione del `type` obbligatorio (EA-123)

- **Descrizione**: `normalizeInitialItem` accetta storicamente un item iniziale espresso come semplice stringa (il solo `title`), oltre che come oggetto `{ title, quantity?, notes? }`. Con EA-123 il campo `type` diventa obbligatorio e validato tramite `isChecklistItemType`, ma lo shorthand a stringa non ha alcun modo di veicolare un `type`: di conseguenza qualunque item iniziale passato come stringa fallisce sempre con `invalid-argument` ("Each item must have a valid type..."), rendendo il ramo `typeof input === "string"` di fatto codice morto per qualunque consumer reale (nessuna checklist può più essere creata con item-stringa). Non è stato deciso se questo ramo debba essere rimosso esplicitamente o mantenuto come guardia difensiva: la Story EA-123 non menziona lo shorthand a stringa, quindi non è stato rimosso in questa sessione per restare aderenti al piano.
- **Evidenza**:
  - `functions/backend/src/organizer/createChecklist.ts` — branch `typeof input === "string"` in `normalizeInitialItem`: `type` resta `undefined`, quindi `isChecklistItemType(type)` è sempre `false` per questo branch
  - `functions/backend/src/organizer/createChecklist.test.ts` — test "throws invalid-argument when an initial item is a bare string (no type)" verifica esplicitamente che questo path sia sempre rifiutato
- **Story/PR/sessione di provenienza**: rilevato durante l'implementazione della Story Jira EA-123 (Epic checklist item model), sessione 2026-07-31.
- **Stato**: da decidere. Proposta: task Jira nell'Epic EA-3 (o nella stessa Epic di EA-123) per decidere se rimuovere esplicitamente il supporto allo shorthand a stringa da `normalizeInitialItem` (semplificando il codice) o se documentarlo come deliberatamente non più supportato, riferimento F-6.
