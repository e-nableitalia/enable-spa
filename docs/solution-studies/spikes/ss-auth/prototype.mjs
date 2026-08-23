// Spike ss-auth/spike-a - throwaway prototype, NOT for merge.
// Question: Does the retry policy handle rate limits?
// Verification approach: prototype a call against the sandbox API
// (recaptchaenterprise.googleapis.com, the only external API called
// synchronously in functions/backend/src/security/recaptcha.ts).

const projectID = "sandbox-spike-project";
const apiKey = "FAKE_KEY_FOR_SPIKE"; // no real credentials available in sandbox
const url = `https://recaptchaenterprise.googleapis.com/v1/projects/${projectID}/assessments?key=${apiKey}`;

async function callOnce(attempt) {
  const start = Date.now();
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ event: { token: "fake-token", siteKey: "fake-site-key" } }),
  });
  const elapsed = Date.now() - start;
  const body = await response.text();
  console.log(`[attempt ${attempt}] status=${response.status} elapsed=${elapsed}ms body=${body.slice(0, 200)}`);
  return response.status;
}

// Reproduce exactly what verifyRecaptcha() does today: ONE fetch call,
// no loop, no backoff, no special-casing of 429. If the call returns
// 429, current production code (recaptcha.ts) just does:
//   if (!response.ok) throw new HttpsError("internal", "Errore chiamata reCAPTCHA REST API");
// i.e. it is treated identically to any other non-2xx status.
const status = await callOnce(1);
console.log(`\nCurrent production code (verifyRecaptcha) would now: ${status === 429 ? "throw HttpsError('internal', ...) immediately, NO retry, NO backoff, NO Retry-After handling" : "throw HttpsError('internal', ...) on any !response.ok (this call returned " + status + ")"}`);
console.log("No second attempt is made regardless of status code: grep across the repo for retry/backoff/retries/maxRetries returns zero matches.");
