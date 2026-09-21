import type { AgentManifest } from "./agentPacks";
import { packById } from "./agentPacks";

function crc32(data: Uint8Array): number {
  let c = ~0 >>> 0;
  for (let i = 0; i < data.length; i++) {
    c ^= data[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function u16(n: number): Uint8Array {
  const b = new Uint8Array(2);
  new DataView(b.buffer).setUint16(0, n, true);
  return b;
}

function u32(n: number): Uint8Array {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n, true);
  return b;
}

function zipStore(files: Array<{ name: string; body: string | Uint8Array; unixMode?: number }>): Blob {
  const enc = new TextEncoder();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const file of files) {
    const name = enc.encode(file.name);
    const data = typeof file.body === "string" ? enc.encode(file.body) : file.body;
    const crc = crc32(data);
    const mode = file.unixMode ?? 0o100644;
    const local = [
      u32(0x04034b50),
      u16(20),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(crc),
      u32(data.length),
      u32(data.length),
      u16(name.length),
      u16(0),
      name,
      data,
    ];
    const localBuf = concat(local);
    locals.push(localBuf);
    const central = concat([
      u32(0x02014b50),
      u16(0x0314),
      u16(20),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(crc),
      u32(data.length),
      u32(data.length),
      u16(name.length),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32((mode << 16) >>> 0),
      u32(offset),
      name,
    ]);
    centrals.push(central);
    offset += localBuf.length;
  }
  const centralDir = concat(centrals);
  const end = concat([
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(files.length),
    u16(files.length),
    u32(centralDir.length),
    u32(offset),
    u16(0),
  ]);
  const bytes = concat([...locals, centralDir, end]);
  // Copy onto a plain ArrayBuffer so BlobPart typing accepts it (TS 5.x / DOM libs).
  const ab = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(ab).set(bytes);
  return new Blob([ab], { type: "application/zip" });
}

function concat(parts: Uint8Array[]): Uint8Array {
  let n = 0;
  for (const p of parts) n += p.length;
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

function readmeFor(manifest: AgentManifest): string {
  const pack = packById(manifest.agent);
  return `Surf AI — one command on your computer

Pack: ${pack.title} (${pack.license})
Model baked in: ${manifest.modelTitle || manifest.model}
Download size for the model: ${manifest.download || "see website"} · ${manifest.ram || ""}

The zip folder is small. The AI model downloads automatically on first LOCAL-SETUP
(needs internet once). After that, chat works offline.

Phones/tablets: use a Mac, Windows, or Linux computer.

1. Unzip this folder.
2. Run ONE command from inside local-ai:

   Mac/Linux:  bash LOCAL-SETUP.sh
   Windows:    LOCAL-SETUP.bat

Chrome opens http://127.0.0.1:18766 — start chatting.
Leave the small window open while you chat.

Same steps for Ollama, GPT4All, Jan, and AnythingLLM packs.
Install Chrome if needed: https://www.google.com/chrome/

Do not double-click local-agent.html — always use LOCAL-SETUP.
Your chats stay on this computer.
`;
}

type Packed = { kind: "text"; body: string } | { kind: "bin"; body: Uint8Array };

const PACK_PATHS = [
  "/local-agent.html",
  "/LOCAL-SETUP.sh",
  "/LOCAL-SETUP.bat",
  "/system.md",
  "/web-llm.js",
  "/pdf.js",
  "/pdf.worker.js",
  "/icon.svg",
  "/favicon.png",
  "/apple-icon.png",
] as const;

const memoryPack = new Map<string, Packed>();

async function readPackFile(path: string, bustCache = false): Promise<Packed | null> {
  if (!bustCache) {
    const hit = memoryPack.get(path);
    if (hit) return hit;
  } else {
    memoryPack.delete(path);
  }
  try {
    const res = await fetch(path, { cache: bustCache ? "no-store" : "force-cache" });
    if (!res.ok) return null;
    const packed: Packed =
      /\.(js|mjs|png|svg)$/i.test(path) || path.endsWith("apple-icon.png")
        ? { kind: "bin", body: new Uint8Array(await res.arrayBuffer()) }
        : { kind: "text", body: await res.text() };
    memoryPack.set(path, packed);
    return packed;
  } catch {
    return memoryPack.get(path) ?? null;
  }
}

/** Pull the standalone zip ingredients into memory while the tab is still online. */
export async function prefetchLocalPack(): Promise<void> {
  await Promise.all(PACK_PATHS.map((path) => readPackFile(path)));
}

export type DownloadPackOpts = {
  manifest?: AgentManifest;
};

/** Build a zip for the chosen agent. User only runs LOCAL-SETUP after unzip. */
export async function downloadOnThisDevice(opts: DownloadPackOpts = {}): Promise<void> {
  const manifest: AgentManifest = opts.manifest || {
    agent: "ollama",
    title: "Ollama",
    license: "Ollama",
    home: "https://ollama.com",
    model: "llama3.2:3b",
    tier: "everyday",
    created: new Date().toISOString().slice(0, 10),
  };
  const pack = packById(manifest.agent);

  const setupSh = await readPackFile("/LOCAL-SETUP.sh", true);
  const setupBat = await readPackFile("/LOCAL-SETUP.bat", true);
  if (!setupSh || setupSh.kind !== "text" || !setupBat || setupBat.kind !== "text") {
    throw new Error(
      "The local zip is not in this tab yet. Stay here — do not close the window. Download once while online.",
    );
  }

  const files: Array<{ name: string; body: string | Uint8Array; unixMode?: number }> = [
    { name: "local-ai/LOCAL-SETUP.sh", body: setupSh.body, unixMode: 0o100755 },
    { name: "local-ai/LOCAL-SETUP.bat", body: setupBat.body },
    { name: "local-ai/agent.json", body: JSON.stringify(manifest, null, 2) + "\n" },
    { name: "local-ai/README.txt", body: readmeFor(manifest) },
  ];

  // Every agent pack opens the same localhost Chrome chat.
  const html = await readPackFile("/local-agent.html", true);
  if (!html || html.kind !== "text") {
    throw new Error("Chat page missing from this site. Refresh and try again.");
  }
  const htmlBody = html.body
    .replace(/<input[^>]*id=["']pick-image["'][^>]*>/gi, "")
    .replace(/<button[^>]*id=["']pick-image-btn["'][^>]*>[\s\S]*?<\/button>/gi, "")
    .replace(/>\s*Upload image\s*</gi, "><");
  files.push({ name: "local-ai/local-agent.html", body: htmlBody });
  for (const name of [
    "system.md",
    "web-llm.js",
    "pdf.js",
    "pdf.worker.js",
    "icon.svg",
    "favicon.png",
    "apple-icon.png",
  ] as const) {
    const extra = await readPackFile(`/${name}`);
    if (!extra) continue;
    files.push({ name: `local-ai/${name}`, body: extra.body });
  }

  const blob = zipStore(files);
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = pack.zipName;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
