"use client";

import type { Health } from "@/lib/api";
import { allowInBrowserLlm } from "@/lib/browserCaps";
import { networkOnline } from "@/lib/net";

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
  const online = typeof navigator !== "undefined" ? networkOnline() : true;
  const model =
    status?.active_model ||
    status?.default_model ||
    (browserOk ? "in-browser model" : "waiting for setup");

  return (
    <div className="engine-panel">
      <div className="tiny muted">What's running</div>
      <ul className="data-help">
        <li className={moss ? "ok" : ""}>
          {!moss
            ? "Moss: waiting — run LOCAL-SETUP on your computer"
            : !online
              ? `Moss: offline keyword search (${status?.moss?.docs ?? 0} pieces)`
              : mossSdk
                ? `Moss: online (${status?.moss?.docs ?? 0} pieces)`
                : `Moss: keyword search (${status?.moss?.docs ?? 0} pieces)`}
        </li>
        <li className={local ? "ok" : ""}>
          {local
            ? `Answers: ${backendLabel(status)} (${model}) on your computer`
            : browserOk
              ? "Answers: in-browser model (or start Ollama locally)"
              : "Answers: waiting — Download zip → LOCAL-SETUP"}
        </li>
        {!local && !browserOk ? (
          <li className="hint-line">Private AI stays on your machine so this tab stays fast.</li>
        ) : /1b|1\.5b|in-browser/i.test(model) || !local ? (
          <li className="hint-line">Light path — fuller answers when Ollama is running locally.</li>
        ) : null}
      </ul>
    </div>
  );
}
