# Spike ss-auth/spike-a — evidenza (usa e getta, non mergiare)

- **Studio**: ss-auth
- **Spike**: spike-a
- **Question**: Does the retry policy handle rate limits?
- **Verification approach**: Prototype a call against the sandbox API.
- **Branch**: `spike/ss-auth-spike-a` (throwaway, nessuna PR)

## Cosa e' stato verificato

1. Ricerca nell'intero repo (`functions`, `requests`, `enable-device`) di qualunque
   logica di retry/backoff (`retry`, `retries`, `maxRetries`, `backoff`,
   `retryPolicy`): **zero occorrenze**. Nessuna dipendenza retry-oriented
   (`axios-retry`, `p-retry`, ecc.) in nessun `package.json` del repo.
2. L'unica chiamata HTTP sincrona verso un servizio esterno nel dominio auth e'
   `verifyRecaptcha` (`functions/backend/src/security/recaptcha.ts`), che
   chiama `https://recaptchaenterprise.googleapis.com/v1/projects/{id}/assessments`.
   Il codice fa **un solo `fetch`**: se `!response.ok` lancia subito
   `HttpsError("internal", "Errore chiamata reCAPTCHA REST API")`, senza
   distinguere lo status code (429 trattato esattamente come 400/500/ecc.),
   senza leggere `Retry-After`, senza secondo tentativo.
3. Il rate limiting presente nel modulo auth (`security/rateLimit.ts`,
   `checkEmailRateLimit` / `checkIpRateLimit`) e' **in ingresso** (protegge
   `register` dagli abusi dei chiamanti), non e' una retry policy verso
   un'API esterna: non e' quindi la stessa cosa della domanda posta.
4. Prototipo eseguito contro l'API reale (sandbox, senza credenziali valide,
   vedi `prototype.mjs` in questa stessa cartella) per confermare che la
   chiamata e' raggiungibile e osservare il comportamento a fronte di un
   errore HTTP: la funzione esegue **un solo tentativo** e propaga l'errore
   immediatamente, in linea con la lettura del codice sorgente.

   Output osservato (progetto/API key fittizi, quindi 403 invece di 429, ma
   il path di gestione errore in `recaptcha.ts` e' identico per qualunque
   `!response.ok`, 429 incluso):

   ```
   [attempt 1] status=403 elapsed=324ms body={"error":{"code":403,"message":"Permission denied on resource project sandbox-spike-project.", ...
   ```

## Risposta alla question

**No.** Non esiste alcuna retry policy nel codice attuale (ne' nel modulo
auth ne' altrove nel repo): di conseguenza non gestisce il rate limiting
(429) in alcun modo — nessun retry, nessun backoff, nessun rispetto di
`Retry-After`. Un 429 dell'API reCAPTCHA Enterprise oggi si traduce
immediatamente in un fallimento hard (`HttpsError("internal", ...)`) esposto
all'utente finale, con lo stesso trattamento di un qualsiasi altro errore
HTTP non gestito.

## Fuori scope / dubbi per il reviewer

- Questo e' un finding preesistente (assenza totale di retry policy sulle
  chiamate esterne del dominio auth), non introdotto da questa spike. Non e'
  stato corretto: la spike ha solo scopo di verifica, non di implementazione.
- Se si decide di introdurre una retry policy, andrebbe valutato come Task
  Jira separato nello studio `ss-auth` (fuori dallo scope di questa sessione).
