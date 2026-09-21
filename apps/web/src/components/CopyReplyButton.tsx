"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { copyReply } from "@/lib/copyReply";

export function CopyReplyButton({
  markdown,
  disabled,
}: {
  markdown: string;
  disabled?: boolean;
}) {
  const [copied, setCopied] = useState(false);

  async function onCopy(e: React.MouseEvent<HTMLButtonElement>) {
    if (!markdown.trim() || disabled) return;
    const wrap = e.currentTarget.closest(".bubble-wrap");
    const bubble = wrap?.querySelector(".bubble.assistant");
    const html = bubble instanceof HTMLElement ? bubble.innerHTML : undefined;
    try {
      await copyReply(markdown, html);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  }

  return (
    <button
      type="button"
      className="linkish copy-reply"
      disabled={disabled || !markdown.trim()}
      title="Copy reply with formatting"
      aria-label={copied ? "Copied" : "Copy reply"}
      onClick={(e) => void onCopy(e)}
    >
      {copied ? <Check size={12} /> : <Copy size={12} />}
      <span>{copied ? "Copied" : "Copy"}</span>
    </button>
  );
}
