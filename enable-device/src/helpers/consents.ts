export const CURRENT_CONSENT_VERSION = "2026-03";

export function hasRequiredConsents(data: Record<string, unknown>): boolean {
  const consents = data?.consents as Record<string, unknown> | undefined;
  const privacy = consents?.privacy as Record<string, unknown> | undefined;
  const code = consents?.codeOfConduct as Record<string, unknown> | undefined;
  return (
    privacy?.accepted === true &&
    privacy?.version === CURRENT_CONSENT_VERSION &&
    code?.accepted === true &&
    code?.version === CURRENT_CONSENT_VERSION
  );
}
