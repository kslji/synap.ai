"use client";

import type { Health } from "@/lib/api";
import { HOST } from "@/lib/config";

export type LocalEngine = "browser" | "ollama";

function backendLabel(status: Health | null): string {
  const id = status?.local_llm?.backend;
  if (id === "lmstudio") return "LM Studio";
  if (id === "llamacpp") return "llama.cpp";
  if (id === "ollama") return "Ollama";
  return "local model";
}

/** RAM comes from the host process (sysctl / Linux pages), not the browser. */
function hostIsThisMachine(): boolean {
  try {
    const host = new URL(HOST).hostname;
    return host === "localhost" || host === "127.0.0.1" || host === "[::1]";
  } catch {
    return false;
  }
}

export function LocalEngines({ status }: { status: Health | null }) {
  const local = !!(status?.local_llm?.backend || status?.ollama) && !!status?.platform?.instance;
  const moss = !!status?.moss?.enabled;
  const model = status?.active_model || status?.default_model || "in-browser model";
  const ramLabel = hostIsThisMachine()
    ? "This computer’s RAM"
    : "Server running the model — RAM";

  return (
    <div className="engine-panel">
      <div className="tiny muted">What's running</div>
      <ul className="data-help">
        <li className={moss ? "ok" : ""}>
          {moss
            ? `Finding text in your files: on (${status?.moss?.docs ?? 0} pieces ready)`
            : "Finding text in your files: off (start the local host to turn this on)"}
        </li>
        <li className={local ? "ok" : ""}>
          {local
            ? `Writing answers with: ${backendLabel(status)} (${model})`
            : "Writing answers with: the small model in this browser (or start Ollama)"}
        </li>
        {local && status?.runtime && (
          <li>
            {ramLabel}: about {status.runtime.ram_gb} GB
          </li>
        )}
        {/1b|1\.5b|in-browser/i.test(model) || !local ? (
          <li className="warn-line">
            Light model: answers stay short. Download the zip on a computer for fuller replies.
            Phones use this browser only — no Terminal setup command.
          </li>
        ) : null}
      </ul>
    </div>
  );
}
