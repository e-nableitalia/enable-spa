# Template email versionati nell'applicazione, con export dei documenti esistenti

## Stato attuale

L'estensione Firebase "Trigger Email" (`firestore-send-email`) è attiva
sul progetto, con supporto nativo a template configurato: la collection
dei template è `emailTemplates`, sul progetto Firebase live, non tracciata
in questo repo (nessun `extensions/*.env`, nessun meccanismo di
seed/sync/export).

**Correzione rispetto alla versione precedente di questa richiesta
(2026-08-12)**: si riteneva che `activateVolunteers` fosse l'unico sender
esistente ad usare lo schema nativo `template: { name, data }`, e che
EA-160 (`sendDocumentsEmail.ts`) introducesse "il primo utilizzo reale nel
codice" di quel meccanismo (vedi `docs/FINDINGS.md` F-37). Verificato nel
codice (sessione 2026-09-06) che è falso: il meccanismo è già in uso da **4
sender preesistenti**, con commit risalenti a prima di marzo 2026 — ben
prima delle sessioni di agosto che hanno scritto quella premessa. La
collection `emailTemplates` sul progetto live contiene esattamente questi 4
documenti (elenco confermato dall'operatore):

| Template | Sender | Modulo/dominio | Esiste sul live |
|---|---|---|---|
| `attivazioneVolontario` | `volunteerState.ts` (`activateVolunteers`) | volunteer-management | Sì |
| `confermaRicezione` | `device/createDeviceRequest.ts` | device-requests | Sì |
| `inviteVolunteer` | `volunteer/invite.ts` | volunteer-management | Sì |
| `shipmentRequest` | `shipments/shipmentRequests.ts` | shipments | Sì |
| `device-request-documents-transmission` | `device-requests/sendDocumentsEmail.ts` (EA-160) | device-requests | **No — bloccante** |

**Bug bloccante attivo**: il quinto template, referenziato da
`sendDocumentsEmail.ts` (EA-160), non esiste sul progetto live. Il bottone
admin "Invia documenti" in `RequestDetail.tsx` fallisce quindi ad ogni uso
reale in produzione (l'estensione Trigger Email non trova il template
referenziato dal documento scritto in `mail`) — non è più solo un gap di
processo (`docs/FINDINGS.md` F-38, ora confermato) ma un difetto
funzionale attivo su una feature già rilasciata.

`activateVolunteers` inoltre scrive **due** email per la stessa
attivazione (una via `message.html` inline, una via `template`) — dato che
`attivazioneVolontario` esiste realmente sul live, entrambe vengono
recapitate: non un fallimento silenzioso come si ipotizzava, ma un doppio
invio reale (`docs/FINDINGS.md` F-37, decisione di prodotto su quale
tenere ancora aperta, non affrontata da questa richiesta).

## Problema

Decidere e realizzare un meccanismo che porti il contenuto dei 5 template
email sotto versionamento nel repository, invece di vivere solo come
stato mutabile non tracciato sul progetto Firebase live. Questo implica
almeno tre parti distinte:

1. **Export**: recuperare il contenuto reale dei 4 documenti
   `emailTemplates` esistenti oggi sul progetto live e portarlo nel
   repository come sorgente di verità versionata.
2. **Mapping template↔codice**: tracciare esplicitamente quale sender usa
   quale template, con quali variabili attese in `data` — oggi questa
   relazione non è verificabile in alcun modo (è proprio l'assenza di
   questa visibilità che ha portato alla premessa sbagliata di EA-160).
3. **Sync forward-only verso Firestore**: un meccanismo che scriva il
   contenuto versionato nel repo sulla collection `emailTemplates` del
   progetto target (staging/prod) — incluso il quinto template, oggi
   mancante, da creare *tramite* questo meccanismo invece che a mano in
   console.

## Direzione proposta dall'operatore (2026-09-05/06)

- **Export**: script Node one-off (Admin SDK), non un componente UI
  permanente — coerente con lo spirito one-shot dello strumento di
  migrazione EA-152, non un endpoint pensato per essere richiamato di
  continuo.
- **Mapping**: un documento di mapping esplicito che tracci l'aggancio
  template↔codice.
- **Sync**: un meccanismo forward-only dallo stato del repo verso
  Firestore (mai il contrario).

## Punti di attenzione emersi in conversazione con il supervisor

- **Enforcement del mapping**: un documento di mapping scritto a mano
  rischia lo stesso destino già osservato su `docs/FINDINGS.md` F-24 (una
  voce rimasta disallineata dal codice reale per settimane) — e, di fatto,
  è la stessa dinamica che ha già prodotto la premessa sbagliata di F-37.
  Da valutare in alternativa (o in aggiunta) un registro nel codice — es.
  un modulo con union type degli ID di template noti, importato da ogni
  sender invece di stringhe libere — verificabile con un test che
  confronta template esportati / ID nel registro / ID effettivamente usati
  nei sender, invece di un markdown descrittivo non auto-verificante.
  Estendibile alle variabili attese in `data` per intercettare un domani
  un sender disallineato dai placeholder Handlebars del template.
- **Meccanismo di trigger del sync**, tre opzioni con trade-off diversi,
  non ancora scelta:
  - script manuale (stesso spirito dell'export) — massimo controllo, ma
    facile da dimenticare dopo una modifica al repo;
  - Cloud Function admin-only da bottone in console — coerente con
    l'idioma già in uso nel progetto (bottone "Migra" EA-152, bottone
    "Invia documenti" EA-160), auditabile con `logSecurityEvent` come il
    resto del dominio;
  - step di deploy CI — orientamento a scartarla: blast radius alto su
    contenuti che arrivano a famiglie reali, nessun gate umano dedicato
    prima dell'invio effettivo.
- **Coesistenza di due fonti di verità**: finché resta possibile editare
  un template direttamente in console Firebase, un sync forward-only può
  sovrascrivere silenziosamente un hotfix fatto lì. Il meccanismo tecnico
  da solo non risolve il problema che questa richiesta vuole chiudere:
  serve accompagnarlo con una convenzione esplicita che congeli gli edit
  diretti in console per i template coperti dal repo.
- **Ambiente**: nessun default implicito staging/prod nello script di
  sync, per evitare di scrivere sull'ambiente sbagliato.
- **Finestra di drift**: un edit concorrente fatto in console tra l'export
  iniziale e il primo sync andrebbe perso al primo sync — rischio basso
  data la bassa frequenza di modifica di questi contenuti, ma da tenere
  presente nella sequenza di rollout.

## Nota per lo studio: possibile collocazione UI

L'operatore ha suggerito (2026-09-06, non ancora deciso, da riprendere in
un secondo momento) che la gestione dei template — ed eventualmente il
trigger del meccanismo di sync, se si opta per una Cloud Function
admin-only da bottone — potrebbe trovare posto in una nuova pagina
"super admin", insieme ad altre sezioni oggi nascoste ma non rimosse
(es. `AdminMaintenanceRequests.tsx`, voce di menu commentata in
`AdminLayout.tsx` dopo `ad75798`, vedi anche F-33). Non è ancora una
decisione, solo un candidato di collocazione da valutare quando si
affronta questo studio.

## Alternativa considerata e scartata

Abbandonare i template nativi dell'estensione per tornare a HTML inline in
TS ovunque (versionato per definizione, zero export/sync) — scartata:
richiederebbe riscrivere i 4 sender già funzionanti e rinunciare al
meccanismo Handlebars già investito, sproporzionato rispetto al problema.

## Domande aperte per lo studio

- **Formato di versionamento**: file per template (es.
  `functions/backend/emailTemplates/<id>.json`) o un unico manifest? Deve
  rispettare lo schema nativo dell'estensione (`subject`/`html`/`text` con
  placeholder Handlebars).
- **Meccanismo di sync**: quale delle 3 opzioni sopra — orientamento verso
  Cloud Function admin-only, da confermare in studio.
- **Enforcement del mapping**: documento descrittivo vs. registro nel
  codice auto-verificante — orientamento verso la seconda opzione.
- **Ambito dell'export iniziale**: ora chiaro — tutti e 4 i template
  esistenti confermati dall'operatore, più la creazione ex novo del quinto
  (`device-request-documents-transmission`) tramite il nuovo meccanismo.
- **Relazione con F-37/F-38**: F-38 diventa parte integrante dello scope
  di questa richiesta (il quinto template va creato tramite il nuovo
  meccanismo, non più a mano in console). F-37 (doppio invio in
  `activateVolunteers`) resta un difetto distinto — l'export toccherà
  comunque il contenuto di `attivazioneVolontario`, buona occasione per
  far decidere all'operatore quale dei due invii tenere, ma non è
  necessariamente nello scope di questa Story.
- **Ambiente**: il meccanismo deve operare simmetricamente su
  `enableitalia-staging` e produzione, o in sequenza?

## Domini coinvolti

- `device-requests` (`createDeviceRequest.ts`, `sendDocumentsEmail.ts`, F-38)
- `volunteer-management` (`volunteerState.ts`, `invite.ts`, F-37)
- `shipments` (`shipmentRequests.ts`) — dominio non individuato nella
  versione originale di questa richiesta, aggiunto dopo la verifica nel
  codice (sessione 2026-09-06)
- Trasversale: nessun modulo Cloud Functions dedicato esiste oggi per
  "gestione template email" — potrebbe emergere come area propria.

## Origine

Richiesta esplicita dell'operatore in conversazione, 2026-08-12, durante
l'analisi dei finding pendenti in `docs/FINDINGS.md`: in risposta a F-38
(template `emailTemplates` di EA-160 da creare manualmente sul progetto
live), l'operatore ha chiesto di pianificare template versionati
nell'applicazione, con un export dei documenti esistenti come parte del
lavoro. Direzione precisata e perimetro corretto in conversazione con il
supervisor, sessione 2026-09-05/06, dopo che una verifica nel codice ha
mostrato che il meccanismo a template era già in uso su 4 sender (non 1) e
che il quinto template (EA-160) risulta confermato mancante sul progetto
live.
