import { doc, updateDoc } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "../firebase";

export interface RequiresAttentionNotifica {
  volunteers?: boolean;
  telegram?: boolean;
}

/**
 * Imposta (value=true, nota obbligatoria) o rimuove (value=false, nessuna nota
 * richiesta) il flag requiresAttention su deviceRequests/{id} e registra la
 * nota corrispondente in timeline via changeStatus. Comportamento invariato
 * rispetto ai due handler storici di RequestDetail.tsx.
 */
export async function setRequiresAttention(
  id: string,
  currentStatus: string | undefined,
  value: boolean,
  note?: string,
  notifica?: RequiresAttentionNotifica
): Promise<void> {
  if (value && !note?.trim()) {
    throw new Error("Nota obbligatoria per impostare il flag 'richiede attenzione'.");
  }

  await updateDoc(doc(db, "deviceRequests", id), { requiresAttention: value });

  const fn = httpsCallable(functions, "changeStatus");
  if (value) {
    await fn({
      requestId: id,
      newStatus: currentStatus,
      note: `⚠️ Richiede attenzione: ${note!.trim()}`,
      notifica: { admin: true, volunteers: notifica?.volunteers ?? false, telegram: notifica?.telegram ?? false },
    });
  } else {
    await fn({
      requestId: id,
      newStatus: currentStatus,
      note: "✅ Flag 'richiede attenzione' rimosso.",
    });
  }
}
