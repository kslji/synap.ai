/** Copy assistant reply as markdown + rich HTML when the clipboard API allows it. */
export async function copyReply(markdown: string, html?: string): Promise<void> {
  const plain = String(markdown || "").replace(/\s+$/, "");
  if (!plain) return;

  const rich =
    html && html.trim()
      ? `<div style="font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,sans-serif;font-size:14px;line-height:1.55;white-space:normal">${html}</div>`
      : "";

  if (rich && typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/plain": new Blob([plain], { type: "text/plain" }),
          "text/html": new Blob([rich], { type: "text/html" }),
        }),
      ]);
      return;
    } catch {
      /* fall through to plain text */
    }
  }

  await navigator.clipboard.writeText(plain);
}
