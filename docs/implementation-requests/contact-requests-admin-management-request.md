# Gestione amministrativa delle richieste di contatto

## Stato attuale

La form pubblica `/contatti` (`enable-device/src/pages/ContactRequest.tsx`) invia
le richieste tramite la Cloud Function `createContactRequest`
(`functions/backend/src/contact/`), con anti-spam. Verificato dal discovery del
2026-11-11: esiste solo la creazione della richiesta. Non ci sono pagine né
funzioni admin per consultare o lavorare le richieste ricevute
(`ContactsList.tsx` appartiene al dominio `volunteer-management` e riguarda gli
inviti ai volontari, non queste richieste).

## Problema

Le richieste di contatto arrivano e vengono salvate, ma gli admin non hanno
una vista dove leggerle, filtrarle e tracciarne la lavorazione. Il summary del
dominio `contacts` prevedeva la "gestione amministrativa" delle richieste:
quella parte è ancora da finalizzare.

## Note

Bozza di tracciamento, registrata il 2026-11-11 su indicazione dell'operatore:
nessuna decisione presa su perimetro, stati della richiesta o RBAC. Non sono
stati avviati studi né work item. Da affinare prima di qualunque
`solution-study`.
