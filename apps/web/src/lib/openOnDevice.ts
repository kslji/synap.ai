import type { AgentManifest } from "./agentPacks";
import {
  assertManifestMatchesFolder,
  packDownloadName,
  packFolderName,
} from "./agentPacks";
import { modelById, modelByTag } from "./localModelCatalog";

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
  const folder = packFolderName(manifest);
  return `Surf AI — ${manifest.modelTitle} pack

THIS PACK MODEL (only):
  Name:  ${manifest.modelTitle}
  Tag:   ${manifest.model}
  Id:    ${manifest.modelId}
  RAM:   ${manifest.ram}
  Size:  ${manifest.download}

Folder: ${folder}
Zip:    ${packDownloadName(manifest)}

Other model packs are separate downloads. This folder is only for ${manifest.modelTitle}.

The zip folder is small. The AI model (${manifest.model}) downloads automatically on first
LOCAL-SETUP (needs internet once). After that, chat works offline.

You can keep many packs unzipped at once (one folder per model). SURF-OPEN lists them.

Phones/tablets: use a Mac, Windows, or Linux computer.

1. Unzip into Downloads (you get ${folder}/).
2. From ANY directory, run ONE command:

   Mac/Linux:
   bash "$(ls -t ~/Downloads/surf-ai-*/SURF-OPEN.sh 2>/dev/null | head -n 1)"

   Windows (PowerShell):
   powershell -NoProfile -Command "& ((Get-ChildItem $env:USERPROFILE\\Downloads\\surf-ai-*\\SURF-OPEN.bat | Sort LastWriteTime -Desc | Select -First 1).FullName)"

   Tip: SURF_MODEL=${manifest.model} bash …/SURF-OPEN.sh

   Or open a terminal inside ${folder} and run:
   Mac/Linux:  bash LOCAL-SETUP.sh
   Windows:    LOCAL-SETUP.bat

Chrome opens http://127.0.0.1:18766 — start chatting with ${manifest.modelTitle}.
Leave the small window open while you chat.

Install Chrome if needed: https://www.google.com/chrome/

Do not double-click local-agent.html — always use LOCAL-SETUP or SURF-OPEN.
Your chats stay on this computer.

Links / YouTube: this local pack cannot open the live web. Paste article text or attach a saved page.

Customize for your platform:
  Edit local-agent.html (chat UI + prompts), system.md (agent instructions), and agent.json
  (model identity). Change those files, then re-run SURF-OPEN / LOCAL-SETUP — the agent is yours
  to reshape for your product, site, or workflow.

Self-check (recommended before chatting):
  Mac/Linux:  bash harness/check-pack.sh
  Windows:    harness\\check-pack.bat
  Full evals (guardrails + Moss):  bash harness/run-evals.sh
  Your custom cases:  bash harness/run-custom.sh
  Or from any folder (latest pack):
    bash "$(ls -t ~/Downloads/surf-ai-*/harness/run-evals.sh 2>/dev/null | head -n 1)"
    bash "$(ls -t ~/Downloads/surf-ai-*/harness/run-custom.sh 2>/dev/null | head -n 1)"
  Edit harness/custom_cases.json (see harness/CUSTOM.md + TESTS.md).

Moss (hackathon / text document retrieval):
  This pack uses Moss to retrieve text from documents you attach or index.
  Flow: attach/index text → Moss retrieves relevant snippets (online) → local model answers.
  Pack includes moss_bridge.py + sealed moss_vault.enc (keys encrypted, not plaintext).
  LOCAL-SETUP starts Moss only while online. Offline chat still works; Moss stays paused.
  Invigilators: sidebar shows "Moss (text document retrieval)" and replies can cite "Moss retrieval … ms".
`;
}

type Packed = { kind: "text"; body: string } | { kind: "bin"; body: Uint8Array };

const PACK_PATHS = [
  "/local-agent.html",
  "/LOCAL-SETUP.sh",
  "/LOCAL-SETUP.bat",
  "/SURF-OPEN.sh",
  "/SURF-OPEN.bat",
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

/** Build a zip for the chosen model. agent.json + folder name must match that model. */
export async function downloadOnThisDevice(opts: DownloadPackOpts = {}): Promise<void> {
  const manifest: AgentManifest = opts.manifest || {
    agent: "ollama",
    title: "Ollama",
    license: "Ollama",
    home: "https://ollama.com",
    model: "llama3.2:1b",
    modelId: "llama32-1b",
    modelTitle: "Llama 3.2 1B",
    download: "~1 GB to download",
    ram: "Fits ~4 GB RAM",
    tier: "light",
    created: new Date().toISOString().slice(0, 10),
  };

  const catalog = modelById(manifest.modelId) || modelByTag(manifest.model);
  if (!catalog || catalog.tag !== manifest.model || catalog.id !== manifest.modelId) {
    throw new Error(
      `Pack model mismatch: ${manifest.modelId}/${manifest.model}. Refresh and download again.`,
    );
  }
  assertManifestMatchesFolder(manifest);

  const setupSh = await readPackFile("/LOCAL-SETUP.sh", true);
  const setupBat = await readPackFile("/LOCAL-SETUP.bat", true);
  const openSh = await readPackFile("/SURF-OPEN.sh", true);
  const openBat = await readPackFile("/SURF-OPEN.bat", true);
  if (!setupSh || setupSh.kind !== "text" || !setupBat || setupBat.kind !== "text") {
    throw new Error(
      "The local zip is not in this tab yet. Stay here — do not close the window. Download once while online.",
    );
  }
  if (!openSh || openSh.kind !== "text" || !openBat || openBat.kind !== "text") {
    throw new Error("Pack opener missing from this site. Refresh and try again.");
  }

  const root = packFolderName(manifest);
  const expectedSlug = packSlugFromModel(catalog.title, catalog.tag);
  if (!root.endsWith(expectedSlug)) {
    throw new Error(`Folder name ${root} does not match model ${catalog.title}.`);
  }

  const packBoot = `window.__SURF_PACK__ = ${JSON.stringify({
    agent: manifest.agent,
    model: manifest.model,
    modelId: manifest.modelId,
    modelTitle: manifest.modelTitle,
    tier: manifest.tier,
    download: manifest.download,
    ram: manifest.ram,
  })};`;

  const modelCard = [
    `Surf AI pack model`,
    `title=${manifest.modelTitle}`,
    `tag=${manifest.model}`,
    `id=${manifest.modelId}`,
    `tier=${manifest.tier}`,
    `ram=${manifest.ram}`,
    `download=${manifest.download}`,
    "",
  ].join("\n");

  const setupShBody = stampSetupScript(setupSh.body, manifest);
  const setupBatBody = stampSetupScript(setupBat.body, manifest);

  const files: Array<{ name: string; body: string | Uint8Array; unixMode?: number }> = [
    { name: `${root}/LOCAL-SETUP.sh`, body: setupShBody, unixMode: 0o100755 },
    { name: `${root}/LOCAL-SETUP.bat`, body: setupBatBody },
    { name: `${root}/SURF-OPEN.sh`, body: openSh.body, unixMode: 0o100755 },
    { name: `${root}/SURF-OPEN.bat`, body: openBat.body },
    { name: `${root}/agent.json`, body: JSON.stringify(manifest, null, 2) + "\n" },
    { name: `${root}/MODEL.txt`, body: modelCard },
    { name: `${root}/README.txt`, body: readmeFor(manifest) },
  ];

  const html = await readPackFile("/local-agent.html", true);
  if (!html || html.kind !== "text") {
    throw new Error("Chat page missing from this site. Refresh and try again.");
  }
  const htmlBody = html.body
    .replace(/\/\*__SURF_PACK_BOOT__\*\//, packBoot)
    .replace(/<title>Surf AI<\/title>/i, `<title>Surf AI · ${manifest.modelTitle}</title>`)
    .replace(/<input[^>]*id=["']pick-image["'][^>]*>/gi, "")
    .replace(/<button[^>]*id=["']pick-image-btn["'][^>]*>[\s\S]*?<\/button>/gi, "")
    .replace(/>\s*Upload image\s*</gi, "><");
  if (!htmlBody.includes(manifest.model) || !htmlBody.includes(manifest.modelTitle)) {
    throw new Error("Failed to bake selected model name into the chat page.");
  }
  // Guard: zip must not advertise a different catalog model as primary.
  for (const other of ["llama3.2:1b", "qwen2.5:1.5b", "llama3.2:3b", "phi3:mini"]) {
    if (other === manifest.model) continue;
    if (htmlBody.includes(`"model":"${other}"`) || htmlBody.includes(`"model": "${other}"`)) {
      throw new Error(`Pack incorrectly embeds other model ${other}.`);
    }
  }
  files.push({ name: `${root}/local-agent.html`, body: htmlBody });

  const systemMd = await readPackFile("/system.md", true);
  if (systemMd && systemMd.kind === "text") {
    const stamped =
      systemMd.body.replace(
        /Inference stays local when a local model is available\.[^\n]*/,
        `Inference stays local. THIS PACK MODEL: ${manifest.modelTitle} (${manifest.model}). If asked which model you are using, answer exactly "${manifest.modelTitle}".`,
      ) +
      `\n\n## Pack identity\nThis download is only for **${manifest.modelTitle}** (\`${manifest.model}\`).\n`;
    files.push({ name: `${root}/system.md`, body: stamped });
  }

  for (const name of [
    "web-llm.js",
    "pdf.js",
    "pdf.worker.js",
    "icon.svg",
    "favicon.png",
    "apple-icon.png",
  ] as const) {
    const extra = await readPackFile(`/${name}`);
    if (!extra) continue;
    files.push({ name: `${root}/${name}`, body: extra.body });
  }

  for (const name of [
    "TESTS.md",
    "CUSTOM.md",
    "MOSS.md",
    "check-pack.sh",
    "check-pack.bat",
    "cases.json",
    "guardrails.py",
    "guardrail_cases.json",
    "custom_cases.json",
    "run-evals.py",
    "run-evals.sh",
    "run-evals.bat",
    "run-custom.py",
    "run-custom.sh",
    "run-custom.bat",
  ] as const) {
    const harness = await readPackFile(`/harness/${name}`, true);
    if (!harness || harness.kind !== "text") continue;
    const unixMode = name.endsWith(".sh") ? 0o100755 : undefined;
    files.push({ name: `${root}/harness/${name}`, body: harness.body, unixMode });
  }

  const mossBridge = await readPackFile("/moss_bridge.py", true);
  if (mossBridge && mossBridge.kind === "text") {
    files.push({ name: `${root}/moss_bridge.py`, body: mossBridge.body });
  }
  const mossVault = await readPackFile("/moss_vault.enc", true);
  if (mossVault && mossVault.kind === "text") {
    // Sealed credentials only — never plaintext project id/key in the zip.
    if (!mossVault.body.includes("surf-seal-v1")) {
      throw new Error("Moss vault missing seal — run npm run seal:moss before building packs.");
    }
    if (/MOSS_PROJECT_KEY|project_key"\s*:\s*"[^"]{8,}"/.test(mossVault.body) && !mossVault.body.includes('"alg"')) {
      throw new Error("Refusing to bake plaintext Moss credentials into a pack.");
    }
    files.push({ name: `${root}/moss_vault.enc`, body: mossVault.body });
  }

  const blob = zipStore(files);
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = packDownloadName(manifest);
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

function stampSetupScript(body: string, manifest: AgentManifest): string {
  const banner = `# Surf AI pack: ${manifest.modelTitle} (${manifest.model})\n`;
  if (body.startsWith("#!")) {
    const nl = body.indexOf("\n");
    return body.slice(0, nl + 1) + banner + body.slice(nl + 1);
  }
  if (/^@echo off/i.test(body)) {
    const nl = body.indexOf("\n");
    return body.slice(0, nl + 1) + `REM Surf AI pack: ${manifest.modelTitle} (${manifest.model})\r\n` + body.slice(nl + 1);
  }
  return banner + body;
}

function packSlugFromModel(title: string, tag: string): string {
  return (
    (title || tag || "pack")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "pack"
  );
}
