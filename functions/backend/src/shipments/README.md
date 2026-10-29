# shipments

Modulo backend che gestisce il ciclo di vita delle richieste di spedizione
(collection Firestore `shipmentRequests`), dalla scelta dell'indirizzo fino
alla consegna o cancellazione. Stati (`ShipmentStatus`): `pending` →
`approved` → `in_transit` → `delivered`, più `deleted`.

## Callable

Tutte definite in `shipmentRequests.ts` come `onCall` (region `europe-west1`)
e richiedono un utente autenticato (`unauthenticated` altrimenti). In ordine
di ciclo di vita:

- `listShipmentAddressBook` — utente registrato in `users`: restituisce la rubrica indirizzi per il form (admin: proprio profilo, tutti i volontari e tutte le `deviceRequests` con indirizzo; altri: proprio profilo e `deviceRequests` assegnate); nessuna transizione di stato.
- `createShipmentRequest` — qualunque utente autenticato: valida i campi obbligatori (`reason`, `senderName`, `senderAddress`, `recipientName`, `recipientAddress`) e crea la richiesta in stato `pending`.
- `approveShipmentRequest` — solo admin: `pending` → `approved` e accoda l'email di conferma nella collection `mail`.
- `updateShipmentTracking` — solo admin: imposta `trackingNumber`; `approved` → `in_transit`, oppure se già `in_transit` aggiorna solo il numero.
- `markShipmentDelivered` — solo admin: `in_transit` → `delivered`.
- `deleteShipmentRequest` — admin in qualunque stato, altrimenti solo il creatore e solo se `pending`: soft delete con stato `deleted`.

## Test

```bash
cd functions/backend && npm test
```

Lo script `test` di `functions/backend/package.json` lancia `jest`; i test del
modulo sono in `shipmentRequests.test.ts` (helper in `testSupport.ts`).

Vedi anche il ciclo di vita in `shipmentRequests.ts`.
