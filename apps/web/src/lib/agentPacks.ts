/** Zip “packs” — user picks one, downloads, runs a single LOCAL-SETUP command. */

import type { RamTier } from "./localModelCatalog";
import { defaultModelForTier } from "./localModelCatalog";

export type AgentId = "surf" | "gpt4all" | "jan" | "anythingllm";

export type AgentPack = {
  id: AgentId;
  title: string;
  license: string;
  blurb: string;
  /** What opens after LOCAL-SETUP */
  opens: string;
  /** Online needed for first install; then offline OK */
  offlineNote: string;
  /** Surf embeds Ollama + browser chat; others launch the desktop app */
  kind: "surf" | "desktop";
  home: string;
  zipName: string;
};

export const AGENT_PACKS: AgentPack[] = [
  {
    id: "surf",
    title: "Surf + Ollama",
    license: "Surf (your zip) · Ollama separate",
    blurb: "Our local chat in Chrome. One command installs Ollama if needed, pulls your model, and opens chat.",
    opens: "Chrome → Surf chat on this computer",
    offlineNote: "First run needs internet for Ollama + model. After that, chat works offline.",
    kind: "surf",
    home: "https://synap.surf",
    zipName: "surf-local-ai.zip",
  },
  {
    id: "gpt4all",
    title: "GPT4All",
    license: "MIT",
    blurb: "Fully open-source local LLMs for personal or commercial use. LOCAL-SETUP downloads and opens the official app.",
    opens: "GPT4All desktop app",
    offlineNote: "First run downloads the installer while online. Later runs open the installed app offline.",
    kind: "desktop",
    home: "https://www.nomic.ai/gpt4all",
    zipName: "surf-gpt4all.zip",
  },
  {
    id: "jan",
    title: "Jan AI",
    license: "AGPL-3.0",
    blurb: "Open-source, privacy-first local AI. One command fetches and launches the official Jan app.",
    opens: "Jan desktop app",
    offlineNote: "First run needs internet to fetch Jan. After install, use Jan offline.",
    kind: "desktop",
    home: "https://jan.ai",
    zipName: "surf-jan.zip",
  },
  {
    id: "anythingllm",
    title: "AnythingLLM",
    license: "MIT",
    blurb: "Open-source chat with your documents on this computer. LOCAL-SETUP installs and opens Desktop.",
    opens: "AnythingLLM desktop app",
    offlineNote: "First run downloads Desktop while online. Your docs stay local afterward.",
    kind: "desktop",
    home: "https://anythingllm.com",
    zipName: "surf-anythingllm.zip",
  },
];

export function packById(id: AgentId): AgentPack {
  return AGENT_PACKS.find((p) => p.id === id) || AGENT_PACKS[0];
}

/** Written into the zip so LOCAL-SETUP needs zero extra flags. */
export type AgentManifest = {
  agent: AgentId;
  title: string;
  license: string;
  home: string;
  /** Ollama tag — only for surf */
  model?: string;
  tier?: RamTier;
  created: string;
};

export function buildManifest(agent: AgentId, tier: RamTier = "everyday"): AgentManifest {
  const pack = packById(agent);
  const model = agent === "surf" ? defaultModelForTier(tier).tag : undefined;
  return {
    agent,
    title: pack.title,
    license: pack.license,
    home: pack.home,
    model,
    tier: agent === "surf" ? tier : undefined,
    created: new Date().toISOString().slice(0, 10),
  };
}

export function oneCommand(os: "mac" | "win" | "linux"): string {
  if (os === "win") return "LOCAL-SETUP.bat";
  return "bash LOCAL-SETUP.sh";
}
