/**
 * Seal Moss project credentials into public/moss_vault.enc (not plaintext).
 * Loads MOSS_* from process.env, then repo-root .env / apps/web/.env if unset.
 * Usage (from apps/web):
 *   npm run seal:moss
 * Without keys, writes an empty sealed vault (keyword fallback only).
 */
import { createHash, createHmac, randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Split parts — must match moss_bridge.py _SEAL_PARTS (never the Moss key itself). */
const SEAL_PARTS = ["surf", "moss", "v1", "pack", "vault", "k7m2p9qx"];

function sealKey() {
  return createHash("sha256").update(SEAL_PARTS.join("|"), "utf8").digest();
}

function xorBuf(data, key) {
  const out = Buffer.alloc(data.length);
  for (let i = 0; i < data.length; i++) out[i] = data[i] ^ key[i % key.length];
  return out;
}

function seal(projectId, projectKey) {
  const key = sealKey();
  const nonce = randomBytes(16);
  const streamKey = createHash("sha256").update(Buffer.concat([key, nonce])).digest();
  const plain = Buffer.from(JSON.stringify({ project_id: projectId || "", project_key: projectKey || "" }), "utf8");
  const ct = xorBuf(plain, streamKey);
  const mac = createHmac("sha256", key).update(Buffer.concat([nonce, ct])).digest("base64");
  return {
    v: 1,
    alg: "surf-seal-v1",
    nonce: nonce.toString("base64"),
    ct: ct.toString("base64"),
    mac,
  };
}

/** Minimal .env loader — fills empty/missing keys; never prints values. */
function loadEnvFile(path) {
  if (!existsSync(path)) return { ok: false, mossId: false, mossKey: false };
  let text = readFileSync(path, "utf8");
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  let mossId = false;
  let mossKey = false;
  for (const raw of text.split(/\r?\n/)) {
    let line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    if (line.startsWith("export ")) line = line.slice(7).trim();
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    let val = line.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    const cur = process.env[key];
    if (cur != null && String(cur).trim().length > 0) {
      if (key === "MOSS_PROJECT_ID") mossId = true;
      if (key === "MOSS_PROJECT_KEY") mossKey = true;
      continue;
    }
    process.env[key] = val;
    if (key === "MOSS_PROJECT_ID" && val) mossId = true;
    if (key === "MOSS_PROJECT_KEY" && val) mossKey = true;
  }
  return { ok: true, mossId, mossKey };
}

const webRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = join(webRoot, "..", "..");
const envPaths = [join(repoRoot, ".env"), join(webRoot, ".env")];
const loadedFrom = [];
let sawIdInFile = false;
let sawKeyInFile = false;
for (const p of envPaths) {
  const r = loadEnvFile(p);
  if (r.ok) {
    loadedFrom.push(p);
    if (r.mossId) sawIdInFile = true;
    if (r.mossKey) sawKeyInFile = true;
  }
}

const outDir = join(webRoot, "public");
mkdirSync(outDir, { recursive: true });
const pid = (process.env.MOSS_PROJECT_ID || "").trim();
const pkey = (process.env.MOSS_PROJECT_KEY || "").trim();
const sealed = seal(pid, pkey);
const outPath = join(outDir, "moss_vault.enc");
writeFileSync(outPath, JSON.stringify(sealed) + "\n", "utf8");

console.log(
  `seal debug: MOSS_PROJECT_ID=${pid ? `set(${pid.length} chars)` : "missing"}` +
    ` MOSS_PROJECT_KEY=${pkey ? `set(${pkey.length} chars)` : "missing"}` +
    ` file_has_id=${sawIdInFile} file_has_key=${sawKeyInFile}`,
);

if (pid && pkey) {
  console.log(`sealed Moss vault → ${outPath} (credentials encrypted; not plaintext)`);
  if (loadedFrom.length) console.log(`  loaded env from: ${loadedFrom.join(", ")}`);
} else {
  console.log(
    `sealed empty Moss vault → ${outPath} (set MOSS_PROJECT_ID / MOSS_PROJECT_KEY in repo .env)`,
  );
  console.log("  checked:", envPaths.join(", "));
  console.log("  tip: git pull, then re-run. Old seal script ignored .env files.");
}
