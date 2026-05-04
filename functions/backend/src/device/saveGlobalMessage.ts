import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { getInvokeId } from "../utils/invoke";
import { logSecurityEvent } from "../security/securityLog";
import { sendTelegramMessage } from "../utils/telegram";

const REGION = "europe-west1";

function htmlToTelegram(text: string): string {
  if (!text) return "";

  let t = text;

  // normalize newline
  t = t.replace(/\\n/g, "\n").replace(/\r\n/g, "\n");

  // remove indentation
  t = t.replace(/^[ \t]+/gm, "");

  // links
  t = t.replace(/<a[^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/gi, (_, url, label) => {
    return `<a href="${url}">${(label as string).trim()}</a>`;
  });

  // bold
  t = t.replace(/<(b|strong)>(.*?)<\/\1>/gi, "<b>$2</b>");

  // headings → bold
  t = t.replace(/<h[1-6][^>]*>(.*?)<\/h[1-6]>/gi, "<b>$1</b>\n\n");

  // list items
  t = t.replace(/<li[^>]*>(.*?)<\/li>/gi, (_, item) => {
    return `• ${(item as string).trim()}\n`;
  });

  // block elements
  t = t.replace(/<\/p>/gi, "\n\n");
  t = t.replace(/<\/div>/gi, "\n\n");
  t = t.replace(/<br\s*\/?>/gi, "\n");

  // remove all other tags
  t = t.replace(/<[^>]+>/g, "");

  // final cleanup
  t = t
    .replace(/\n[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]+\n/g, "\n")
    .trim();

  return t;
}

interface SaveGlobalMessageData {
  id?: string;
  title: string;
  body: string;
  target: "all" | "volunteer" | "admin";
  active: boolean;
  expiresAt?: string | null;
  notifyTelegram: boolean;
}

export const saveGlobalMessage = onCall(
  {
    region: REGION,
    secrets: ["TELEGRAM_API_URL", "TELEGRAM_API_SECRET"],
  },
  async (req) => {
    const invokeId = getInvokeId(req);
    console.log(`[saveGlobalMessage] Invoke ID: ${invokeId}`);

    const { auth, data } = req;
    if (!auth) {
      throw new HttpsError("unauthenticated", "Authentication required");
    }

    const db = getFirestore();
    const actorSnap = await db.collection("users").doc(auth.uid).get();
    if (!actorSnap.exists || actorSnap.data()?.role !== "admin") {
      throw new HttpsError("permission-denied", "Only admins can manage global messages");
    }

    const { id, title, body, target, active, expiresAt, notifyTelegram } =
      data as SaveGlobalMessageData;

    if (!title?.trim() || !body?.trim()) {
      throw new HttpsError("invalid-argument", "title and body are required");
    }
    if (!["all", "volunteer", "admin"].includes(target)) {
      throw new HttpsError("invalid-argument", "Invalid target value");
    }

    const isNew = !id;
    const payload: Record<string, unknown> = {
      title: title.trim(),
      body: body.trim(),
      target,
      active,
      expiresAt: expiresAt ?? null,
      notifyTelegram,
    };

    let messageId = id;
    let errorMsg: string | undefined;

    try {
      if (isNew) {
        payload.createdAt = FieldValue.serverTimestamp();
        payload.createdBy = auth.uid;
        const ref = await db.collection("messages").add(payload);
        messageId = ref.id;
      } else {
        payload.updatedAt = FieldValue.serverTimestamp();
        payload.updatedBy = auth.uid;
        await db.collection("messages").doc(id as string).update(payload);
      }

      await logSecurityEvent({
        type: "system",
        action: isNew ? "create_global_message" : "update_global_message",
        outcome: "success",
        severity: "medium",
        actor: { uid: auth.uid },
        context: {
          function: "saveGlobalMessage",
          invokeId,
          metadata: { messageId, title: title.trim(), target, notifyTelegram },
        },
      });

      console.log(`[saveGlobalMessage] OK: ${isNew ? "created" : "updated"} message ${messageId}`);

      // Notifica Telegram solo per i nuovi messaggi con flag attivo
      if (notifyTelegram && isNew) {
        const apiUrl = process.env.TELEGRAM_API_URL;
        const secret = process.env.TELEGRAM_API_SECRET;
        if (apiUrl && secret) {
          const tgText = `📢 Nuovo messaggio: <b>${title.trim()}</b>\n\n${htmlToTelegram(body.trim())}`;
          await sendTelegramMessage(apiUrl, secret, tgText).catch((err) => {
            console.warn("[saveGlobalMessage] Telegram notification failed:", err);
          });
        } else {
          console.warn("[saveGlobalMessage] notifyTelegram=true but TELEGRAM_API_URL/TELEGRAM_API_SECRET not configured");
        }
      }

      return { success: true, id: messageId, isNew };
    } catch (error) {
      errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`[saveGlobalMessage] KO: ${errorMsg}`);

      await logSecurityEvent({
        type: "system",
        action: isNew ? "create_global_message" : "update_global_message",
        outcome: "failure",
        severity: "medium",
        actor: { uid: auth.uid },
        context: {
          function: "saveGlobalMessage",
          invokeId,
          metadata: { title: title.trim(), target, error: errorMsg },
        },
      });

      if (error instanceof HttpsError) throw error;
      throw new HttpsError("internal", "Errore durante il salvataggio del messaggio");
    }
  }
);
