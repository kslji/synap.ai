/** Models users can bake into a zip — plain language download + RAM guidance. */

export type RamTier = "light" | "everyday" | "strong" | "workstation";

export type OllamaModelOption = {
  id: string;
  tag: string;
  title: string;
  tier: RamTier;
  /** Short download size, e.g. "~2 GB" */
  download: string;
  /** RAM the computer should have */
  ram: string;
  /** Who it is for — simple professional line */
  forWho: string;
  /** One sentence about everyday use */
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
    download: "~1 GB to download",
    ram: "Works on ~8 GB RAM",
    forWho: "Students and light office notes",
    about: "Smallest pack. Quick answers for short questions; best on older or thin laptops.",
    pull: "ollama pull llama3.2:1b",
  },
  {
    id: "qwen25-15b",
    tag: "qwen2.5:1.5b",
    title: "Qwen 2.5 1.5B",
    tier: "light",
    download: "~1 GB to download",
    ram: "Works on ~8 GB RAM",
    forWho: "Light writing and quick checks",
    about: "Same light footprint as 1B. Good spare option when you want a second small model.",
    pull: "ollama pull qwen2.5:1.5b",
  },
  {
    id: "llama32-3b",
    tag: "llama3.2:3b",
    title: "Llama 3.2 3B",
    tier: "everyday",
    download: "~2 GB to download",
    ram: "Comfortable on 8–16 GB RAM",
    forWho: "Most professionals — email, docs, meetings",
    about: "Recommended default. Clearer answers without needing a heavy computer.",
    pull: "ollama pull llama3.2:3b",
  },
  {
    id: "phi3-mini",
    tag: "phi3:mini",
    title: "Phi-3 Mini",
    tier: "everyday",
    download: "~2.5 GB to download",
    ram: "Comfortable on 8–16 GB RAM",
    forWho: "Analysts and document Q&A",
    about: "Everyday chat and file questions. Slightly larger download than 3B Llama.",
    pull: "ollama pull phi3:mini",
  },
  {
    id: "mistral-7b",
    tag: "mistral:7b",
    title: "Mistral 7B",
    tier: "strong",
    download: "~4 GB to download",
    ram: "Ideally 16 GB+ RAM",
    forWho: "Writers, developers, longer briefs",
    about: "Stronger drafting and reasoning. Needs a capable laptop or desktop.",
    pull: "ollama pull mistral:7b",
  },
  {
    id: "llama31-8b",
    tag: "llama3.1:8b",
    title: "Llama 3.1 8B",
    tier: "strong",
    download: "~5 GB to download",
    ram: "Ideally 16 GB+ RAM",
    forWho: "Knowledge work and longer documents",
    about: "Higher quality for attached files and multi-step questions.",
    pull: "ollama pull llama3.1:8b",
  },
  {
    id: "qwen25-14b",
    tag: "qwen2.5:14b",
    title: "Qwen 2.5 14B",
    tier: "workstation",
    download: "~9 GB to download",
    ram: "32 GB+ RAM recommended",
    forWho: "Power users and research desks",
    about: "Large download. Best on a workstation; slow on light laptops.",
    pull: "ollama pull qwen2.5:14b",
  },
  {
    id: "llama33-70b",
    tag: "llama3.3:70b",
    title: "Llama 3.3 70B",
    tier: "workstation",
    download: "~40 GB to download",
    ram: "High-RAM machine / GPU",
    forWho: "Labs and high-end workstations only",
    about: "Very large download and disk use. Only if your computer is built for big local models.",
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

export function modelById(id: string): OllamaModelOption | undefined {
  return OLLAMA_MODELS.find((m) => m.id === id);
}

export function modelByTag(tag: string): OllamaModelOption | undefined {
  return OLLAMA_MODELS.find((m) => m.tag === tag);
}
