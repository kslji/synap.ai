"use client";

import type { Health } from "@/lib/api";
import { allowInBrowserLlm } from "@/lib/browserCaps";
import { LOCAL_HOST } from "@/lib/config";
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
    (browserOk ? "in-browser model" : "local host required");

  return (
    <div className="engine-panel">
      <div className="tiny muted">What's running</div>
      <ul className="data-help">
        <li className={moss ? "ok" : ""}>
          {!moss
            ? `Moss: off (start local host at ${LOCAL_HOST})`
            : !online
              ? `Moss: offline keyword fallback (${status?.moss?.docs ?? 0} pieces on this device)`
              : mossSdk
                ? `Moss: online SDK retriever (${status?.moss?.docs ?? 0} pieces)`
                : `Moss: keyword fallback (${status?.moss?.docs ?? 0} pieces — add .env Moss keys for SDK)`}
        </li>
        <li className={local ? "ok" : ""}>
          {local
            ? `Writing answers with: ${backendLabel(status)} (${model}) on this computer`
            : browserOk
              ? "Writing answers with: optional in-browser model (or start local Ollama)"
              : `Writing answers with: local host at ${LOCAL_HOST} (Download zip → LOCAL-SETUP)`}
        </li>
        {!local && !browserOk ? (
          <li className="warn-line">
            Local-First: chat does not call our website server for AI. Start the Small Cloud host on
            this machine so Ollama/Moss stay private and the tab never freezes.
          </li>
        ) : /1b|1\.5b|in-browser/i.test(model) || !local ? (
          <li className="warn-line">
            Light path: answers stay short until Ollama is up on this computer via the local host.
          </li>
        ) : null}
      </ul>
    </div>
  );
}
