Collegare il modulo Organizer core (vedi process-organizer-core.md, di cui
questa Epic è dipendente) al processo di fabbricazione di una singola
`deviceRequest` esistente.

Questa Epic aggiunge il livello device-specifico sopra al motore generico:
non reimplementa checklist/template/clonazione (già nel core), ma li
collega a device, tipologie, volontari e RBAC reali.

## Collegamento a deviceRequest

Ogni `deviceRequest` ha una propria istanza di checklist Organizer,
concettualmente separata dal suo stato macro pubblico (di cui si occupa
device-lifecycle-refactoring.md — non toccare quella parte qui).

## Catalogo template per tipo device

- Catalogo curato dagli admin: un template di checklist di default per
  ciascun `devicetype` esistente (Kinetic Hand, Kinetic Arm, Bike Adapter,
  Guitar Pick, Kwawu Arm, Device Batteria, Kwawu Gripper, Phoenix Hand,
  incluso "Altro" libero).
- Solo admin può creare/modificare/eliminare i template di questo catalogo.
- Alla creazione della checklist per un device specifico, viene proposto
  il template del suo `devicetype` come punto di partenza (usando il
  meccanismo di template del core).

## Clona da device simile

Oltre al template curato, deve essere possibile popolare la checklist di
un nuovo device clonando quella di un device precedente (stesso
`devicetype` o scelto liberamente), usando il meccanismo di clonazione
già previsto nel core.

## Condivisione con visibilità a livelli — punto critico

Va progettato con attenzione data la convenzione esistente di separazione
PII (`private_data_separation`) nel resto del repo. Il meccanismo NON deve
replicare il pattern del mockup di riferimento (blob base64 nell'URL,
nessuna persistenza): deve essere un link/token persistito lato server
(Firestore), con lo scope di visibilità determinato server-side.

Due livelli di visibilità:
- **Livello famiglia/pubblico**: link di sola consultazione, NESSUN dato
  critico esposto — presumibilmente solo avanzamento macro/percentuale
  completamento checklist, senza nomi assegnatari, note, o altri dettagli
  interni. I campi esatti visibili a questo livello vanno definiti in
  modo esplicito in fase di story/acceptance criteria, non lasciati
  impliciti.
- **Livello volontari/interno**: condivisione più ricca (probabilmente
  checklist completa con stati e assegnatari) ma comunque senza dati PII
  del beneficiario.

Domande aperte, da chiarire in fase di epic/story review, non da assumere:
- Il link scade? È revocabile?
- Esiste un link per tier di visibilità, o un solo link con logica di
  scoping interna?
- Chi può generare il link (l'assegnatario, un admin, chiunque abbia
  accesso alla richiesta)?
- "Famiglia" e "visibilità pubblica esterna" sono lo stesso tier con gli
  stessi dati visibili, o due tier distinti? (assunto qui come stesso
  tier — da confermare esplicitamente)

## Non in scope in questa Epic

- Cambiamenti al macro-stato pubblico della richiesta (Epic
  device-lifecycle-refactoring.md).
- Item con campi strutturati extra (rimandato, vedi process-organizer-core.md).
- Notifiche push/email legate ai cambi di stato della checklist.
- Qualsiasi modifica al core generico stesso (dipendenza, non modifica).