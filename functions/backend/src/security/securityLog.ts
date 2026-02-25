import { getFirestore, FieldValue } from "firebase-admin/firestore";

type SecurityEvent = {
  type?: "security" | "auth" | "form" | "system";
  action: string;
  outcome?: "success" | "failure" | "blocked";
  severity?: "low" | "medium" | "high" | "critical";
  actor?: {
    uid?: string;
    email?: string;
    ip?: string;
    provider?: string;
  };
  context?: {
    function: string;
    invokeId?: string;
    requestId?: string;
    metadata?: Record<string, any>;
  };
};

export async function logSecurityEvent(event: SecurityEvent) {
  const db = getFirestore();

  const normalized = {
    type: event.type ?? "security",
    action: event.action,
    outcome: event.outcome ?? "success",
    severity: event.severity ?? "low",
    actor: {
      uid: event.actor?.uid ?? null,
      email: event.actor?.email ?? null,
      ip: event.actor?.ip ?? null,
      provider: event.actor?.provider ?? null,
    },
    context: {
      function: event.context?.function ?? "unknown",
      requestId: event.context?.requestId ?? null,
      metadata: event.context?.metadata ?? null,
    },
    createdAt: FieldValue.serverTimestamp(),
  };

  await db.collection("securityLogs").add(normalized);
}