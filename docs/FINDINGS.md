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
