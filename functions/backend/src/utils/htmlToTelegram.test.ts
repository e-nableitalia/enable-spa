import {
  escapeTelegramHtml,
  formatGlobalMessageForTelegram,
  htmlToTelegram,
} from "./htmlToTelegram";

describe("escapeTelegramHtml", () => {
  it("escapes &, < and >", () => {
    expect(escapeTelegramHtml(`A & B <C>`)).toBe("A &amp; B &lt;C&gt;");
  });
});

describe("htmlToTelegram", () => {
  it("returns empty string for empty input", () => {
    expect(htmlToTelegram("")).toBe("");
  });

  it("preserves <b> and <strong> as <b>", () => {
    expect(htmlToTelegram("<p>Ciao <b>mondo</b></p>")).toBe("Ciao <b>mondo</b>");
    expect(htmlToTelegram("Hello <strong>world</strong>")).toBe("Hello <b>world</b>");
  });

  it("preserves links", () => {
    expect(htmlToTelegram(`Vedi <a href="https://example.com">qui</a>`)).toBe(
      `Vedi <a href="https://example.com">qui</a>`
    );
    expect(htmlToTelegram(`<a href='https://example.com'>qui</a>`)).toBe(
      `<a href="https://example.com">qui</a>`
    );
  });

  it("preserves italic and underline", () => {
    expect(htmlToTelegram("<i>a</i> <em>b</em> <u>c</u>")).toBe("<i>a</i> <i>b</i> <u>c</u>");
  });

  it("converts headings to bold + blank line", () => {
    expect(htmlToTelegram("<h2>Titolo</h2><p>corpo</p>")).toBe("<b>Titolo</b>\n\ncorpo");
  });

  it("converts list items to bullets", () => {
    expect(htmlToTelegram("<ul><li>uno</li><li>due</li></ul>")).toBe("• uno\n• due");
  });

  it("strips unknown tags while keeping text", () => {
    expect(htmlToTelegram('<span class="x">ciao</span>')).toBe("ciao");
    expect(htmlToTelegram("<script>alert(1)</script>safe")).toBe("alert(1)safe");
  });

  it("escapes special characters in plain text", () => {
    expect(htmlToTelegram("A < B & C > D")).toBe("A &lt; B &amp; C &gt; D");
  });

  it("handles br and paragraphs", () => {
    expect(htmlToTelegram("a<br>b</p><p>c")).toBe("a\nb\n\nc");
  });
});

describe("formatGlobalMessageForTelegram", () => {
  it("formats title as bold without Nuovo messaggio prefix", () => {
    const result = formatGlobalMessageForTelegram("Avviso", "<p>Ciao <b>tutti</b></p>");
    expect(result).toBe("📢 <b>Avviso</b>\n\nCiao <b>tutti</b>");
    expect(result).not.toContain("Nuovo messaggio");
  });

  it("escapes special characters in the title", () => {
    expect(formatGlobalMessageForTelegram("A < B & C", "ok")).toBe(
      "📢 <b>A &lt; B &amp; C</b>\n\nok"
    );
  });
});
