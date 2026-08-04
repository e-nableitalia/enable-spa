import type { Firestore } from "firebase-admin/firestore";
import { sendEmailToDeviceAdmins } from "../utils/email";
import { sendTelegramMessage } from "../utils/telegram";

export interface NotificaOptions {
  admin?: boolean;
  volunteers?: boolean;
  telegram?: boolean;
}

export interface SendChangeStatusNotificationsParams {
  db: Firestore;
  requestId: string;
  requestData: FirebaseFirestore.DocumentData | undefined;
  currentStatus: string;
  newStatus: string;
  note?: string;
  notifica: NotificaOptions;
}

/**
 * Notifiche opzionali post-transizione di `changeStatus` (estratte da
 * `changeStatus.ts` righe 100-163, EA-104): costruisce subject/html/testo
 * Telegram e invia email admin, email ai volontari assegnati con email
 * valorizzata e messaggio Telegram, in base a quali canali sono abilitati
 * in `notifica`. Nessuna semantica cambiata rispetto al comportamento
 * pre-refactoring: stessi destinatari, stesso testo, stesso fallback per
 * Telegram non configurato, stesso uso di `Promise.allSettled` (un
 * fallimento di un canale non blocca gli altri).
 */
export async function sendChangeStatusNotifications({
  db,
  requestId,
  requestData,
  currentStatus,
  newStatus,
  note,
  notifica,
}: SendChangeStatusNotificationsParams): Promise<void> {
  const statoChanged = currentStatus !== newStatus;

  // Recupera requestNumber da publicDeviceRequests
  let requestLabel = requestId;
  try {
    const pubSnap = await db.collection("publicDeviceRequests").doc(requestId).get();
    const rn = pubSnap.data()?.requestNumber;
    if (rn) requestLabel = `#${rn}`;
  } catch { /* fallback a requestId */ }

  const subject = statoChanged
    ? `[e-Nable] Richiesta ${requestLabel}: stato → ${newStatus}`
    : `[e-Nable] Richiesta ${requestLabel}: aggiornamento (stato: ${currentStatus})`;
  const html = `
    ${statoChanged
    ? `<p>La richiesta <strong>${requestLabel}</strong> è passata da <em>${currentStatus}</em> a <strong>${newStatus}</strong>.</p>`
    : `<p>La richiesta <strong>${requestLabel}</strong> è in stato <strong>${currentStatus}</strong>.</p>`
}
    ${note ? `<p>Nota: ${note}</p>` : ""}
  `;
  const tgMessage = note
    ? `Aggiornamento richiesta ${requestLabel}: ${note}${statoChanged ? ` (${currentStatus} → ${newStatus})` : ` (stato: ${currentStatus})`}`
    : statoChanged
      ? `Aggiornamento richiesta ${requestLabel}: ${currentStatus} → ${newStatus}`
      : `Aggiornamento richiesta ${requestLabel}: stato corrente ${currentStatus}`;

  const jobs: Promise<unknown>[] = [];

  if (notifica.admin) {
    jobs.push(sendEmailToDeviceAdmins(subject, html));
  }
  if (notifica.volunteers) {
    const assignedVolunteers: string[] = requestData?.assignedVolunteers ?? [];
    if (assignedVolunteers.length > 0) {
      const volunteerSnaps = await Promise.all(
        assignedVolunteers.map((vid) => db.collection("users").doc(vid).get())
      );
      for (const vSnap of volunteerSnaps) {
        const email: string | undefined = vSnap.data()?.email;
        if (email) {
          jobs.push(
            db.collection("mail").add({
              to: [email],
              message: { subject, html },
            })
          );
        }
      }
    }
  }
  if (notifica.telegram) {
    const apiUrl = process.env.TELEGRAM_API_URL;
    const secret = process.env.TELEGRAM_API_SECRET;
    if (apiUrl && secret) {
      jobs.push(sendTelegramMessage(apiUrl, secret, tgMessage));
    } else {
      console.warn("Telegram notifica richiesta ma TELEGRAM_API_URL/TELEGRAM_API_SECRET non configurati");
    }
  }

  await Promise.allSettled(jobs);
}
