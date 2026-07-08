Introdurre un modulo "Organizer core": un motore generico per checklist
assegnabili con avanzamento, template e clonazione da istanza precedente.
Ispirato a un mockup Angular già realizzato per l'organizzazione di eventi
di volontariato (workshop, fiere), ma pensato qui come modulo riusabile,
non specifico a nessun dominio applicativo del repo attuale.

## Vincolo di design, non negoziabile in questa Epic

Il core NON deve contenere nessun riferimento a `deviceRequest`, PII,
RBAC device-specifico, o qualsiasi altro concetto legato a un dominio
applicativo particolare. È infrastruttura condivisa: il collegamento a un
caso d'uso specifico (device di fabbricazione) è responsabilità dell'Epic
device-organizer-integration.md, che dipende da questa ma non viceversa.

Nota consapevole: costruire qualcosa di generico con un solo consumatore
reale (i device) è un rischio di over-engineering. Non è richiesto estrarlo
come pacchetto separato o libreria pubblicabile fin da subito — è
sufficiente che i confini di responsabilità siano puliti (nessun leak di
concetti device-specifici nel core), così che un'estrazione futura, quando
arriverà un secondo consumatore reale (es. organizzazione eventi/workshop),
sia un refactoring a basso costo e non una riscrittura.

## Modello checklist (v1, minimale)

Ogni item ha: titolo, assegnatario, quantità (opzionale), note, stato
(quattro valori: Assegnare/Da iniziare/In corso/Completata), flag di
completamento. NESSUN campo strutturato extra per ora (niente equivalente
del caso "deck" del mockup di riferimento) — se emergerà la necessità di
item con campi aggiuntivi specifici per tipo, sarà una richiesta futura
separata, non va anticipata qui.

Riferimento di modello dati (framework-agnostico, riutilizzabile come punto
di partenza, non copiato 1:1): le interfacce TypeScript in `models.ts` del
mockup allegato (`Card`, `TaskItem`, `PastWorkshop`) — sono pure interfacce
dati, non legate ad Angular.

## Template e cataloghi

- Catalogo di template checklist, ciascuno associato a una "categoria"
  generica (il concetto di categoria stesso è definito dal consumatore,
  es. `devicetype` per i device — il core si limita a un identificatore
  di categoria opaco, senza sapere cosa rappresenta).
- CRUD del catalogo: ruolo abilitato a gestirlo è deciso dal consumatore
  (il core espone il meccanismo, non la policy di autorizzazione).

## Clona da istanza precedente

Deve essere possibile creare una nuova checklist clonando gli item di
un'istanza precedente qualsiasi (stessa categoria o scelta libera),
azzerando stato/assegnatari sui nuovi item clonati. Riferimento di logica
(non di codice) nel mockup allegato: funzione `useWorkshopAsTemplate`.

## Estendibilità a runtime

Indipendentemente dall'origine (template o clone), ogni checklist istanza
è sempre liberamente modificabile: aggiungere, rimuovere, rinominare item
in qualsiasi momento.

## Gate di completezza

Un meccanismo di verifica "checklist pronta/completa" (tutti gli item
hanno assegnatario, quantità se richiesta, stato non iniziale) — pattern
di riferimento nel mockup: funzione `canConfirm`. Il consumatore decide
cosa fare quando la checklist risulta completa (es. sbloccare una
transizione di stato altrove), il core si limita a esporre lo stato di
completezza.

## Esplicitamente NON incluso in questa Epic

- Qualsiasi meccanismo di condivisione esterna/link pubblico — è
  responsabilità dell'Epic device-organizer-integration.md, e comunque
  NON deve replicare il pattern del mockup allegato (blob base64 in URL,
  nessuna persistenza) — quel meccanismo va escluso anche come
  ispirazione architetturale, non solo come implementazione.
- Qualsiasi collegamento a `deviceRequest`, volontari, o PII.
- Notifiche push/email.

## Nota sul mockup allegato come riferimento

Il mockup contiene due componenti quasi identici (`task1-screen`,
`task2-screen`), duplicati per rapidità prototipale — NON è un pattern di
design da riprendere: il target è un singolo componente generico
parametrizzato per categoria, non uno per categoria.