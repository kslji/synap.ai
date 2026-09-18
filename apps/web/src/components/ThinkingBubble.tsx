"use client";

export function ThinkingBubble({ label }: { label: string }) {
  return (
    <div className="bubble assistant think" aria-live="polite">
      <span className="think-dots" aria-hidden>
        <i />
        <i />
        <i />
      </span>
      <span className="think-label">{label || "Thinking"}</span>
    </div>
  );
}
