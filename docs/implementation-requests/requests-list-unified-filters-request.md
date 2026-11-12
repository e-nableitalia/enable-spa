# Filtri e modello di vista unificati per le liste di richieste (admin e volontario)

## Stato attuale

Le liste di richieste admin passano tutte da `AdminRequestsWorkspace` e
`AdminRequestTable` (`enable-device/src/components/requests/`). Sopra i 1200px
`isDesktop` e' sempre vero, quindi la tabella e' sempre in modalita' `compact`
(lista a sinistra, dettaglio a destra): in `compact` vengono nascoste colonne e,
con esse, i filtri di colonna (`filterDisplay="row"`). In admin restano visibili
solo ID, nome, cognome e stato, e di fatto si filtra solo sull'ID. La vista
piena non compare mai in admin. I filtri sono in `sessionStorage`
(chiave `adminRequestTableFilters`).

La pagina di ricerca dei volontari (`VolunteerAdminFilters.tsx`) ha invece un
pannello filtri completo, con filtri "globali" e filtri di colonna, e la
selezione delle colonne. Le due liste usano due modelli di presentazione
distinti.

## Problema

Recuperare la richiesta corretta e' difficile: pochi filtri disponibili,
filtri di colonna poco visibili, nessun modo di vedere i filtri attivi, e il
comportamento dipende dalla modalita' `compact` invece che dalle esigenze
dell'utente. Il problema riguarda tutte le viste/subset di richieste.

## Obiettivo (concordato con l'operatore, 2026-11-11)

1. **Filtri base sempre visibili** (3-4): ID, nome, cognome, stato.
2. **Filtri estesi in un pannello collassabile** (genere, amputazione, device,
   stato pubblico, provincia, destinatario, volontario assegnato (solo admin),
   richiede attenzione, intervalli di date). A pannello collassato un
   indicatore segnala che ci sono filtri estesi attivi.
3. **Pulsante di reset** di tutti i filtri.
4. **Persistenza dei filtri** al cambio di pagina o di vista delle richieste
   (stato condiviso tra le viste).
5. **Selezione delle colonne** da visualizzare, mantenuta e indipendente da
   `compact`.
6. **Elenco sotto ai filtri con scroll verticale e orizzontale** quando la
   larghezza delle colonne supera l'area visibile.
7. **Componenti riusabili** (pannello filtri, stato dei filtri, modello di
   vista) sia nella vista admin sia nella vista volontario.

## Fuori perimetro

Modifiche a dati, backend o permessi. Nessuna modifica alla pagina di ricerca
dei volontari oltre a un eventuale riuso di parti comuni.
