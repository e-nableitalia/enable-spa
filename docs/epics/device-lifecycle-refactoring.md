Semplificare e riorganizzare la gestione dello stato delle richieste dispositivo.

Oggi `changeStatus` governa 19 stati interni distinti, con transizioni volontario
hardcoded (`isAllowedVolunteerTransition`) e un mapping centralizzato verso 5
gruppi di stato pubblico (da validare, da gestire, fabbricazione in corso,
completati, annullate/non completabili).

Obiettivo: vincolare la gestione dello stato "macro" della richiesta ai soli
stati pubblici esistenti (o un piccolo superset esplicito, da definire in
fase di story), e delegare il governo granulare del processo di fabbricazione
al modulo Organizer (vedi request-file separati: process-organizer-core.md e
device-organizer-integration.md) — questa Epic dipende concettualmente da
quei due lavori ma non li include.

## Cosa deve rimanere invariato (comportamento pubblico)

- I 5 gruppi di stato pubblico attuali, incluso "da validare" come step
  distinto e necessario (anonimizzazione della richiesta prima della
  visibilità ai volontari) — non va rimosso né assorbito in "da gestire".
- Le regole RBAC attuali: admin qualsiasi transizione, volontario solo se
  assegnato e solo transizioni consentite.
- Le notifiche opzionali post-transizione (admin/volontari/Telegram).
- Il flag "attività critica" (requiresAttention) e la sua gestione.
- L'event sourcing su `deviceRequests/{id}/events` per la timeline.

## Cosa va riorganizzato/semplificato

- Gli attuali 19 stati interni vanno ripensati: quelli che oggi servono solo
  a tracciare avanzamento granulare di fabbricazione (es. scelta device,
  personalizzazione, attesa materiali) diventano responsabilità
  dell'Organizer (tramite device-organizer-integration.md), non del
  macro-stato qui trattato.
- La logica di assegnazione volontari, cambio stato macro, e gestione del
  flag critico va ripulita/riorganizzata (il codice attuale in
  `changeStatus.ts`/`RequestDetail.tsx` mescola più responsabilità).

## Dipendenza di sequenza

Questa Epic ha senso essere completata DOPO device-organizer-integration.md
(o in parallelo con forte coordinamento) — semplificare il macro-stato prima
che l'Organizer sappia gestire il dettaglio granulare lascerebbe un vuoto
funzionale. Da confermare in fase di pianificazione delle tre Epic insieme.

## Non in scope in questa Epic

- Il modulo Organizer stesso (checklist, template, condivisione) — Epic separate.
- Cambiamenti alla validazione/anonimizzazione (`cap-request-validation`) —
  resta come oggi.