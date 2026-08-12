# Template email versionati nell'applicazione, con export dei documenti esistenti

## Stato attuale

L'estensione Firebase "Trigger Email" (`firestore-send-email`) è attiva
sul progetto, con supporto nativo a template configurato: la collection
dei template è `emailTemplates` (confermato dall'operatore, non
deducibile dal codice — la configurazione dell'estensione vive solo sul
progetto Firebase live, non è tracciata in questo repo).

Oggi il contenuto di quei template (oggetto, corpo HTML, variabili
attese) esiste **solo** come documenti Firestore sul progetto live,
creati/modificati direttamente in console — nessuna copia versionata nel
repository, nessun meccanismo di seed/sync/export. Due sender nel codice
già dipendono (o dipenderanno) da template in questa collection:

- `functions/backend/src/volunteer/volunteerState.ts` (`activateVolunteers`):
  scrive già oggi `template: { name: "attivazioneVolontario", data: {} }`
  su `mail`, oltre a un secondo invio ridondante via `message.html`
  inline per la stessa email (vedi `docs/FINDINGS.md` F-37 — non toccato
  da questa richiesta, ma stesso dominio di problema).
- `functions/backend/src/device-requests/sendDocumentsEmail.ts` (EA-160):
  referenzia `DOCUMENTS_EMAIL_TEMPLATE_ID = "device-request-documents-transmission"`,
  un documento che va creato manualmente sul progetto live prima che
  l'invio funzioni davvero (`docs/FINDINGS.md` F-38).

Non esiste alcun file `extensions/*.env`, script di seed/migrazione
Firestore, o altro meccanismo in questo repo per scrivere/sincronizzare
dati applicativi (a differenza di codice/regole, che sono già versionati
e deployati via CI) sul progetto Firebase live.

## Problema

Decidere e realizzare un meccanismo che porti il contenuto dei template
email sotto versionamento nel repository, invece di vivere solo come
stato mutabile non tracciato sul progetto Firebase live. Questo implica
almeno due parti distinte:

1. **Export**: recuperare il contenuto reale dei documenti `emailTemplates`
   esistenti oggi sul progetto live (almeno `attivazioneVolontario`, se
   esiste davvero — vedi F-37, non confermato) e portarlo nel repository
   come sorgente di verità versionata.
2. **Sync/seed verso Firestore**: un meccanismo (script, Cloud Function
   amministrativa, o step di deploy) che scriva il contenuto versionato
   nel repo sulla collection `emailTemplates` del progetto target
   (staging/prod), così che modificare un template nel repo si traduca
   in un aggiornamento effettivo via un percorso ripetibile, non più
   solo via console.

## Domande aperte per lo studio

- **Formato di versionamento**: file per template (es.
  `functions/backend/emailTemplates/attivazioneVolontario.json` o
  `.html`+metadata) o un unico manifest? Deve rispettare lo schema nativo
  dell'estensione (`subject`/`html`/`text` con placeholder Handlebars,
  vedi `firestore-send-email`).
- **Meccanismo di sync**: script Node eseguito manualmente
  dall'operatore (pattern più vicino a quanto già esiste, es. lo
  strumento di migrazione one-shot di EA-152), oppure una Cloud Function
  admin-only invocabile da UI, oppure un passo del workflow di deploy
  CI? Ciascuna opzione ha un trade-off diverso tra automazione e
  controllo umano su una scrittura diretta in produzione.
- **Ambito dell'export iniziale**: recuperare solo `attivazioneVolontario`
  (unico template noto per certo, dato che è referenziato da codice
  esistente), o un export completo di tutta la collection
  `emailTemplates` così com'è oggi sul progetto live, indipendentemente
  da cosa sia referenziato da codice?
- **Relazione con F-37/F-38**: questa richiesta è la soluzione
  strutturale a entrambi (il template `device-request-documents-transmission`
  di EA-160 andrebbe creato *tramite* questo meccanismo, non più a mano
  in console) — da confermare se i due finding vadano chiusi come
  conseguenza di questa Epic o restino task separati.
- **Ambiente**: il meccanismo deve operare simmetricamente su
  `enableitalia-staging` e produzione, o solo su uno dei due in prima
  battuta?

## Domini coinvolti

- `device-requests` (`sendDocumentsEmail.ts`, F-38)
- `volunteer-management` (`volunteerState.ts`/`activateVolunteers`, F-37)
- Trasversale: nessun modulo Cloud Functions dedicato esiste oggi per
  "gestione template email" — potrebbe emergere come area propria.

## Origine

Richiesta esplicita dell'operatore in conversazione, 2026-08-12, durante
l'analisi dei finding pendenti in `docs/FINDINGS.md`: in risposta a F-38
(template `emailTemplates` di EA-160 da creare manualmente sul progetto
live), l'operatore ha chiesto di pianificare template versionati
nell'applicazione, con un export dei documenti esistenti come parte del
lavoro.
