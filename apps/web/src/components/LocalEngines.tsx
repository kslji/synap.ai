"use client";

import type { Health } from "@/lib/api";

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
  const model = status?.active_model || status?.default_model || "in-browser model";

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
        {local && status?.runtime && <li>This computer’s RAM: about {status.runtime.ram_gb} GB</li>}
      </ul>
    </div>
  );
}
