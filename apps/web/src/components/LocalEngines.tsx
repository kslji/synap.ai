"use client";

import type { Health } from "@/lib/api";
import { allowInBrowserLlm } from "@/lib/browserCaps";

export type LocalEngine = "browser" | "ollama";

function backendLabel(status: Health | null): string {
  const id = status?.local_llm?.backend;
  if (id === "lmstudio") return "LM Studio";
  if (id === "llamacpp") return "llama.cpp";
  if (id === "ollama") return "Ollama";
  return "local model";
}

export function LocalEngines({ status }: { status: Health | null }) {
  const local = !!(status?.local_llm?.backend || status?.ollama) && !!status?.platform?.instance;
  const moss = !!status?.moss?.enabled;
  const mossSdk = !!status?.moss?.sdk || status?.moss?.backend === "moss";
  const browserOk = allowInBrowserLlm();
  const model =
    status?.active_model ||
    status?.default_model ||
    (browserOk ? "in-browser model" : "attach files / start Ollama");

  return (
    <div className="engine-panel">
      <div className="tiny muted">What's running</div>
      <ul className="data-help">
        <li className={moss ? "ok" : ""}>
          {moss
            ? mossSdk
              ? `Moss search: on (${status?.moss?.docs ?? 0} pieces · SDK)`
              : `Moss search: keyword fallback (${status?.moss?.docs ?? 0} pieces — .env keys load Moss SDK)`
            : "Moss search: off (start the local host)"}
        </li>
        <li className={local ? "ok" : ""}>
          {local
            ? `Writing answers with: ${backendLabel(status)} (${model})`
            : browserOk
              ? "Writing answers with: the small model in this browser (or start Ollama)"
              : "Writing answers with: file-grounded replies here (start Ollama or Download zip for full AI)"}
        </li>
        {!local && !browserOk ? (
          <li className="warn-line">
            In-browser model is off on this site so the tab never freezes. Use Ollama or Download zip for
            fuller replies; attached files still work.
          </li>
        ) : /1b|1\.5b|in-browser/i.test(model) || !local ? (
          <li className="warn-line">
            Light model: answers stay short. Download the zip on a computer for fuller replies.
            Phones use this browser only — no Terminal setup command.
          </li>
        ) : null}
      </ul>
    </div>
  );
}
