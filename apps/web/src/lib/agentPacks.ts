/** Zip packs — every pack: one LOCAL-SETUP → Chrome chat on localhost. */

import type { RamTier } from "./localModelCatalog";
import { defaultModelForTier, modelByTag } from "./localModelCatalog";
import { runSetupCommand } from "./setupCommands";

export type AgentId = "ollama" | "gpt4all" | "jan" | "anythingllm";

export type AgentPack = {
  id: AgentId;
  title: string;
  license: string;
  blurb: string;
  /** Shown on the card — download / disk expectation for the agent itself */
  downloadHint: string;
  opens: string;
  offlineNote: string;
  home: string;
  zipName: string;
};

export const AGENT_PACKS: AgentPack[] = [
  {
    id: "ollama",
    title: "Ollama",
    license: "Ollama · local model engine",
    blurb: "Private chat in Chrome on this computer. One command installs Ollama, pulls your model, and opens localhost chat.",
    downloadHint: "Zip is small (~few MB). The AI model is a separate download (1–40 GB) chosen below.",
    opens: "Chrome → http://127.0.0.1:18766 chat",
    offlineNote: "Online once for Ollama + model. Then the same command works offline.",
    home: "https://ollama.com",
    zipName: "ollama-local-ai.zip",
  },
  {
    id: "gpt4all",
    title: "GPT4All",
    license: "MIT · open source",
    blurb: "Same one-command Chrome chat. Uses GPT4All’s open stack with a local model you pick by computer size.",
    downloadHint: "Zip is small. Model download depends on the card you pick (about 1–40 GB).",
    opens: "Chrome → localhost chat",
    offlineNote: "Online once to install + pull the model. Chat works offline afterward.",
    home: "https://www.nomic.ai/gpt4all",
    zipName: "gpt4all-local-ai.zip",
  },
  {
    id: "jan",
    title: "Jan AI",
    license: "AGPL-3.0 · open source",
    blurb: "Privacy-first local agent. One command opens Chrome chat on this computer — no extra developer steps.",
    downloadHint: "Zip is small. Model size follows the card you choose (about 1–40 GB).",
    opens: "Chrome → localhost chat",
    offlineNote: "First run needs internet. Later runs open chat offline.",
    home: "https://jan.ai",
    zipName: "jan-local-ai.zip",
  },
  {
    id: "anythingllm",
    title: "AnythingLLM",
    license: "MIT · open source",
    blurb: "Document-friendly local agent. One command opens Chrome on localhost so you can chat with files on this PC.",
    downloadHint: "Zip is small. Model download is separate — pick a size that fits your RAM below.",
    opens: "Chrome → localhost chat",
    offlineNote: "Online once for setup + model. Then chat and files stay on this computer offline.",
    home: "https://anythingllm.com",
    zipName: "anythingllm-local-ai.zip",
  },
];

export function packById(id: AgentId): AgentPack {
  return AGENT_PACKS.find((p) => p.id === id) || AGENT_PACKS[0];
}

export type AgentManifest = {
  agent: AgentId;
  title: string;
  license: string;
  home: string;
  model: string;
  modelTitle?: string;
  download?: string;
  ram?: string;
  tier: RamTier;
  created: string;
};

export function buildManifest(
  agent: AgentId,
  tier: RamTier = "everyday",
  modelTag?: string,
): AgentManifest {
  const pack = packById(agent);
  const model = (modelTag && modelByTag(modelTag)) || defaultModelForTier(tier);
  return {
    agent,
    title: pack.title,
    license: pack.license,
    home: pack.home,
    model: model.tag,
    modelTitle: model.title,
    download: model.download,
    ram: model.ram,
    tier,
    created: new Date().toISOString().slice(0, 10),
  };
}

export function oneCommand(os: "mac" | "win" | "linux"): string {
  return runSetupCommand(os);
}

/** Browser download filename — model-aware, not agent product branding. */
export function packSlug(manifest: AgentManifest): string {
  const model = (manifest.modelTitle || manifest.model || "pack")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return model || "pack";
}

export function packDownloadName(manifest: AgentManifest): string {
  return `surf-ai-${packSlug(manifest)}.zip`;
}

/** Unzipped folder name — unique per model so multiple packs can coexist. */
export function packFolderName(manifest: AgentManifest): string {
  return `surf-ai-${packSlug(manifest)}`;
}
