/** Ollama models + Colibri install — shown on synap.surf download shell / zip README. */

export type RamTier = "light" | "everyday" | "strong" | "workstation";

export type OllamaModelOption = {
  id: string;
  /** ollama pull tag */
  tag: string;
  title: string;
  tier: RamTier;
  /** Approx download / RAM need — plain language for users */
  needs: string;
  about: string;
  pull: string;
};

export const RAM_TIERS: Array<{
  id: RamTier;
  label: string;
  hint: string;
}> = [
  { id: "light", label: "Light laptop", hint: "About 8 GB RAM or less" },
  { id: "everyday", label: "Everyday laptop", hint: "About 8–16 GB RAM" },
  { id: "strong", label: "Strong laptop / desktop", hint: "About 16–32 GB RAM" },
  { id: "workstation", label: "Workstation", hint: "32 GB+ RAM (GPU helps)" },
];

export const OLLAMA_MODELS: OllamaModelOption[] = [
  {
    id: "llama32-1b",
    tag: "llama3.2:1b",
    title: "Llama 3.2 1B",
    tier: "light",
    needs: "~1 GB download · fits ~8 GB RAM",
    about: "Fastest replies. Good for short questions on older laptops.",
    pull: "ollama pull llama3.2:1b",
  },
  {
    id: "qwen25-15b",
    tag: "qwen2.5:1.5b",
    title: "Qwen 2.5 1.5B",
    tier: "light",
    needs: "~1 GB download · fits ~8 GB RAM",
    about: "Light alternative when you want a second small model.",
    pull: "ollama pull qwen2.5:1.5b",
  },
  {
    id: "llama32-3b",
    tag: "llama3.2:3b",
    title: "Llama 3.2 3B",
    tier: "everyday",
    needs: "~2 GB download · comfortable on 8–16 GB RAM",
    about: "Best default for most people. Clearer answers without a heavy PC.",
    pull: "ollama pull llama3.2:3b",
  },
  {
    id: "phi3-mini",
    tag: "phi3:mini",
    title: "Phi-3 Mini",
    tier: "everyday",
    needs: "~2.5 GB download · 8–16 GB RAM",
    about: "Solid everyday chat and file questions.",
    pull: "ollama pull phi3:mini",
  },
  {
    id: "mistral-7b",
    tag: "mistral:7b",
    title: "Mistral 7B",
    tier: "strong",
    needs: "~4 GB download · ideally 16 GB+ RAM",
    about: "Stronger writing and reasoning on a capable laptop or desktop.",
    pull: "ollama pull mistral:7b",
  },
  {
    id: "llama31-8b",
    tag: "llama3.1:8b",
    title: "Llama 3.1 8B",
    tier: "strong",
    needs: "~5 GB download · ideally 16 GB+ RAM",
    about: "Good quality for longer chats and attached documents.",
    pull: "ollama pull llama3.1:8b",
  },
  {
    id: "qwen25-14b",
    tag: "qwen2.5:14b",
    title: "Qwen 2.5 14B",
    tier: "workstation",
    needs: "~9 GB download · 32 GB+ RAM recommended",
    about: "Heavier model for workstations. Slower on weak machines.",
    pull: "ollama pull qwen2.5:14b",
  },
  {
    id: "llama33-70b",
    tag: "llama3.3:70b",
    title: "Llama 3.3 70B",
    tier: "workstation",
    needs: "~40 GB download · high-RAM / GPU machine",
    about: "Only if your computer is built for large local models.",
    pull: "ollama pull llama3.3:70b",
  },
];

export function modelsForTier(tier: RamTier): OllamaModelOption[] {
  return OLLAMA_MODELS.filter((m) => m.tier === tier);
}

export function defaultModelForTier(tier: RamTier): OllamaModelOption {
  const list = modelsForTier(tier);
  return list[0] || OLLAMA_MODELS[2];
}

/** Colibri — optional local agent (OpenAI-compatible API on :8000). */
export const COLIBRI_REPO = "https://github.com/JustVugg/colibri.git";

export const COLIBRI_INSTALL_UNIX = `git clone ${COLIBRI_REPO} ~/colibri && cd ~/colibri/c && ./setup.sh && echo "Next: put a Colibri model on disk, then: COLI_MODEL=/path/to/model ./coli serve"`;

export const COLIBRI_INSTALL_WIN = `git clone ${COLIBRI_REPO} %USERPROFILE%\\colibri && cd %USERPROFILE%\\colibri\\c && python coli info`;

export const COLIBRI_BLURB =
  "Colibri runs large MoE models on your machine (experts streamed from disk). Needs a one-time download while online; after that chat works offline. Start with a small Colibri container if your disk is limited — big GLM containers are hundreds of GB.";

export function ollamaInstallHint(os: "mac" | "win" | "linux"): string {
  if (os === "win") return "Install Ollama from https://ollama.com , then run the pull command below.";
  if (os === "linux") return "curl -fsSL https://ollama.com/install.sh | sh";
  return "Install Ollama from https://ollama.com (Mac app), then run the pull command below.";
}
