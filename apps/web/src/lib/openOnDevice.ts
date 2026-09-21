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
  const zip = concat([...locals, centralDir, end]);
  const copy = new ArrayBuffer(zip.byteLength);
  new Uint8Array(copy).set(zip);
  return new Blob([copy], { type: "application/zip" });
}

function concat(parts: Uint8Array[]): Uint8Array {
  const n = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

const README = `Surf AI — use this on your computer

Phones and tablets: do not use this zip. There is no Terminal setup on mobile.
Download from synap.surf on a Mac, Windows, or Linux computer instead.

1. Double-click the zip to unpack it, then open the local-ai folder.
2. Open Terminal (Mac: Command + Space, type Terminal) or Command Prompt (Windows).
   Paste this one line and press Return:

     Mac/Linux:  cd ~/Downloads/local-ai && bash LOCAL-SETUP.sh
     Windows:    cd %USERPROFILE%\\Downloads\\local-ai && LOCAL-SETUP.bat

3. Google Chrome opens Surf AI by itself. Leave the small window open while you chat.

Install Google Chrome first if you do not have it:
https://www.google.com/chrome/

Do not double-click local-agent.html in Finder. Always start with the command above.
Your chats stay on this computer. Nothing is sent to ChatGPT or Claude.

Moss (optional): if you also run the full local host with MOSS_PROJECT_ID / MOSS_PROJECT_KEY
in its .env and you are online, Surf uses Moss to find text in your files. If credits or keys
fail, it falls back to on-device keyword search automatically.

Keep every file in this folder together. local-agent.html needs:
  icon.svg / favicon.png / apple-icon.png  (browser tab logo)
  pdf.js / pdf.worker.js                   (PDF text)
  web-llm.js                               (in-browser model helper)
Moving the HTML out alone breaks the logo and PDF reading.

Account and email stay on the website — they are not part of this download.
`;

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
    const packed: Packed = /\.(js|mjs|png|svg)$/i.test(path) || path.endsWith("apple-icon.png")
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

export async function downloadOnThisDevice(): Promise<void> {
  // Always re-fetch HTML/setup so the zip never ships a stale "Upload image" menu.
  const html = await readPackFile("/local-agent.html", true);
  const setupSh = await readPackFile("/LOCAL-SETUP.sh", true);
  const setupBat = await readPackFile("/LOCAL-SETUP.bat", true);
  if (!html || html.kind !== "text" || !setupSh || setupSh.kind !== "text" || !setupBat || setupBat.kind !== "text") {
    throw new Error(
      "The local zip is not in this tab yet. Stay here — do not close the window. Download once while online, or keep chatting in this window.",
    );
  }
  // Hard guard: never ship an image-upload control in the offline pack.
  const htmlBody = html.body
    .replace(/<input[^>]*id=["']pick-image["'][^>]*>/gi, "")
    .replace(/<button[^>]*id=["']pick-image-btn["'][^>]*>[\s\S]*?<\/button>/gi, "")
    .replace(/>\s*Upload image\s*</gi, "><");
  const files: Array<{ name: string; body: string | Uint8Array; unixMode?: number }> = [
    { name: "local-ai/local-agent.html", body: htmlBody },
    { name: "local-ai/LOCAL-SETUP.sh", body: setupSh.body, unixMode: 0o100755 },
    { name: "local-ai/LOCAL-SETUP.bat", body: setupBat.body },
    { name: "local-ai/README.txt", body: README },
  ];
  for (const name of ["system.md", "web-llm.js", "pdf.js", "pdf.worker.js", "icon.svg", "favicon.png", "apple-icon.png"] as const) {
    const extra = await readPackFile(`/${name}`);
    if (!extra) continue;
    files.push({ name: `local-ai/${name}`, body: extra.body });
  }
  const blob = zipStore(files);
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "local-ai-on-this-device.zip";
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
