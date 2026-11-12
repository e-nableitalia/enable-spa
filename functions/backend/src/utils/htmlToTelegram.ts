/**
 * Converte HTML "di base" (come inserito nelle comunicazioni admin) nel
 * subset HTML supportato da Telegram (parse_mode HTML): b, i, u, a.
 *
 * Usa placeholder per i tag ammessi così lo strip finale dei tag sconosciuti
 * non li cancella — bug storico di `saveGlobalMessage.htmlToTelegram`.
 */

const STASH_OPEN = "\uE000";
const STASH_CLOSE = "\uE001";

export function escapeTelegramHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Solo tag HTML reali (nome che inizia con lettera o /), non testo tipo `A < B`. */
function stripTags(text: string): string {
  return text.replace(/<\/?[a-zA-Z][^>]*>/g, "");
}

function escapeAttr(url: string): string {
  return url.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

/**
 * Converte body HTML → stringa Telegram HTML (solo body, senza titolo).
 */
export function htmlToTelegram(html: string): string {
  if (!html) return "";

  let t = html.replace(/\\n/g, "\n").replace(/\r\n/g, "\n");
  t = t.replace(/^[ \t]+/gm, "");

  const tokens: string[] = [];
  const stash = (value: string): string => {
    const key = `${STASH_OPEN}${tokens.length}${STASH_CLOSE}`;
    tokens.push(value);
    return key;
  };

  // Link (href doppio o singolo quote)
  t = t.replace(
    /<a\b[^>]*href\s*=\s*(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/gi,
    (_m, _q, url: string, label: string) => {
      const text = stripTags(label).trim() || url;
      return stash(`<a href="${escapeAttr(url)}">${escapeTelegramHtml(text)}</a>`);
    }
  );

  // Bold
  t = t.replace(/<(b|strong)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_m, _tag, inner: string) =>
    stash(`<b>${escapeTelegramHtml(stripTags(inner))}</b>`)
  );

  // Italic
  t = t.replace(/<(i|em)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_m, _tag, inner: string) =>
    stash(`<i>${escapeTelegramHtml(stripTags(inner))}</i>`)
  );

  // Underline
  t = t.replace(/<u\b[^>]*>([\s\S]*?)<\/u>/gi, (_m, inner: string) =>
    stash(`<u>${escapeTelegramHtml(stripTags(inner))}</u>`)
  );

  // Headings → bold + blank line
  t = t.replace(/<h[1-6]\b[^>]*>([\s\S]*?)<\/h[1-6]>/gi, (_m, inner: string) =>
    `${stash(`<b>${escapeTelegramHtml(stripTags(inner).trim())}</b>`)}\n\n`
  );

  // List items (possono contenere stash già creati — non toccarli)
  t = t.replace(/<li\b[^>]*>([\s\S]*?)<\/li>/gi, (_m, item: string) => {
    const withoutTags = stripTags(item).trim();
    return `• ${withoutTags}\n`;
  });

  // Block / breaks
  t = t.replace(/<\/p>/gi, "\n\n");
  t = t.replace(/<\/div>/gi, "\n\n");
  t = t.replace(/<br\s*\/?>/gi, "\n");
  t = t.replace(/<\/?(?:p|div|ul|ol|span)\b[^>]*>/gi, "");

  // Strip remaining HTML tags (stash markers non matchano)
  t = stripTags(t);

  // Escape testo plain + ripristina token già formattati/escaped
  t = t.replace(
    new RegExp(`${STASH_OPEN}(\\d+)${STASH_CLOSE}|([^${STASH_OPEN}]+)`, "g"),
    (_m, idx: string | undefined, plain: string | undefined) => {
      if (idx !== undefined) {
        return tokens[Number(idx)] ?? "";
      }
      return escapeTelegramHtml(plain ?? "");
    }
  );

  return t
    .replace(/\n[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

/**
 * Layout completo del messaggio globale inviato su Telegram.
 * Titolo in bold (escaped), senza prefisso "Nuovo messaggio:".
 */
export function formatGlobalMessageForTelegram(title: string, body: string): string {
  const safeTitle = escapeTelegramHtml(title.trim());
  const tgBody = htmlToTelegram(body.trim());
  if (!tgBody) {
    return `📢 <b>${safeTitle}</b>`;
  }
  return `📢 <b>${safeTitle}</b>\n\n${tgBody}`;
}
