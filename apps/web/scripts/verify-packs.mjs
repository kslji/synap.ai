/**
 * Hackathon guard: unique model id/tag/folder for every enabled pack.
 * Run from apps/web: node scripts/verify-packs.mjs
 */

const ENABLED = [
  {
    id: "llama32-1b",
    tag: "llama3.2:1b",
    title: "Llama 3.2 1B",
    tier: "light",
  },
  {
    id: "qwen25-15b",
    tag: "qwen2.5:1.5b",
    title: "Qwen 2.5 1.5B",
    tier: "light",
  },
  {
    id: "llama32-3b",
    tag: "llama3.2:3b",
    title: "Llama 3.2 3B",
    tier: "everyday",
  },
  {
    id: "phi3-mini",
    tag: "phi3:mini",
    title: "Phi-3 Mini",
    tier: "everyday",
  },
];

function slug(title, tag) {
  return (
    (title || tag || "pack")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "pack"
  );
}

const ids = new Set();
const tags = new Set();
const folders = new Set();

for (const m of ENABLED) {
  if (ids.has(m.id)) throw new Error(`Duplicate model id: ${m.id}`);
  if (tags.has(m.tag)) throw new Error(`Duplicate model tag: ${m.tag}`);
  ids.add(m.id);
  tags.add(m.tag);

  const folder = `surf-ai-${slug(m.title, m.tag)}`;
  if (folders.has(folder)) throw new Error(`Duplicate folder ${folder}`);
  folders.add(folder);

  // Catch lookalike / substring traps (e.g. 1b vs 1.5b folder mixups).
  for (const other of ENABLED) {
    if (other.id === m.id) continue;
    if (other.tag === m.tag) throw new Error(`Tag collision ${m.tag}`);
    if (slug(other.title, other.tag) === slug(m.title, m.tag)) {
      throw new Error(`Slug collision between ${m.id} and ${other.id}`);
    }
  }

  console.log(`ok  ${m.id} → ${folder} / ${m.tag}`);
}

console.log(`verified ${ENABLED.length} unique packs`);
