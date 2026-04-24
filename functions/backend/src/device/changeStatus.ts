import {onCall, HttpsError} from "firebase-functions/v2/https";
import {getFirestore, FieldValue} from "firebase-admin/firestore";
import {mapToPublicStatus} from "../utils/mapToPublicStatus";
import {requireVolunteerConsents} from "../utils/consents";
import {sendEmailToDeviceAdmins} from "../utils/email";
import {sendTelegramMessage} from "../utils/telegram";

interface NotificaOptions {
  admin?: boolean;
  volunteers?: boolean;
  telegram?: boolean;
}

export const changeStatus = onCall(
  {
    region: "europe-west1",
    secrets: [
      "TELEGRAM_API_URL",
      "TELEGRAM_API_SECRET",
    ],
  },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) {
      throw new HttpsError("unauthenticated", "User must be authenticated");
    }

    await requireVolunteerConsents(uid);
    const {requestId, newStatus, note, notifica} = request.data as {
      requestId: string;
      newStatus: string;
      note?: string;
      notifica?: NotificaOptions;
    };

    if (!requestId || !newStatus) {
      throw new HttpsError("invalid-argument", "Missing parameters");
    }

    const db = getFirestore();

    const userSnap = await db.collection("users").doc(uid).get();
    if (!userSnap.exists) {
      throw new HttpsError("permission-denied", "User not found");
    }

    const role = userSnap.data()?.role;

    const requestRef = db.collection("deviceRequests").doc(requestId);
    const requestSnap = await requestRef.get();

    if (!requestSnap.exists) {
      throw new HttpsError("not-found", "Request not found");
    }

    const requestData = requestSnap.data();
    const currentStatus = requestData?.status;

    // --- Controllo ruolo ---
    if (role === "admin") {
      // Admin può fare qualsiasi transizione
    } else if (role === "volunteer") {
      if (!requestData?.assignedVolunteers?.includes(uid)) {
        throw new HttpsError("permission-denied", "Not assigned volunteer");
      }

      if (!isAllowedVolunteerTransition(currentStatus, newStatus)) {
        throw new HttpsError("permission-denied", "Invalid status transition");
      }
    } else {
      throw new HttpsError("permission-denied", "Invalid role");
    }

    await db.runTransaction(async (tx) => {

      tx.update(requestRef, {
        status: newStatus,
        publicStatus: mapToPublicStatus(newStatus),
        updatedAt: FieldValue.serverTimestamp()
      });

      tx.set(requestRef.collection("events").doc(), {
        type: "status_change",
        fromStatus: currentStatus,
        toStatus: newStatus,
        timestamp: FieldValue.serverTimestamp(),
        createdBy: uid,
        note: note || null
      });

      tx.set(
        db.collection("publicDeviceRequests").doc(requestId),
        {
          publicStatus: mapToPublicStatus(newStatus)
        },
        {merge: true}
      );
    });

    // --- Notifiche opzionali ---
    if (notifica) {
      const statoChanged = currentStatus !== newStatus;
      const subject = statoChanged
        ? `[e-Nable] Richiesta ${requestId}: stato → ${newStatus}`
        : `[e-Nable] Richiesta ${requestId}: aggiornamento (stato: ${currentStatus})`;
      const html = `
        ${statoChanged
          ? `<p>La richiesta <strong>${requestId}</strong> è passata da <em>${currentStatus}</em> a <strong>${newStatus}</strong>.</p>`
          : `<p>La richiesta <strong>${requestId}</strong> è in stato <strong>${currentStatus}</strong>.</p>`
        }
        ${note ? `<p>Nota: ${note}</p>` : ""}
      `;
      const tgMessage = note
        ? `Aggiornamento richiesta: ${note}${statoChanged ? ` (${currentStatus} → ${newStatus})` : ` (stato: ${currentStatus})`}`
        : statoChanged
          ? `Aggiornamento richiesta: ${currentStatus} → ${newStatus}`
          : `Aggiornamento richiesta: stato corrente ${currentStatus}`;

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
                  message: {subject, html},
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

    return {success: true};
  }
);

function isAllowedVolunteerTransition(from: string, to: string): boolean {
  return (
    (from === "scelta device e dimensionamento" && to === "personalizzazione") ||
    (from === "personalizzazione" && to === "attesa materiali") ||
    (from === "attesa materiali" && to === "fabbricazione") ||
    (from === "fabbricazione" && to === "pronta per spedizione") ||
    (from === "pronta per spedizione" && to === "spedita")
  );
}

