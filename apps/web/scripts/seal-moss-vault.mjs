/**
 * Seal Moss project credentials into public/moss_vault.enc (not plaintext).
 * Usage (from apps/web):
 *   MOSS_PROJECT_ID=... MOSS_PROJECT_KEY=... node scripts/seal-moss-vault.mjs
 * Without env vars, writes an empty sealed vault (keyword fallback only).
 */
import { createHash, createHmac, randomBytes } from "node:crypto";
import { writeFileSync, mkdirSync } from "node:fs";
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

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "public");
mkdirSync(outDir, { recursive: true });
const pid = (process.env.MOSS_PROJECT_ID || "").trim();
const pkey = (process.env.MOSS_PROJECT_KEY || "").trim();
const sealed = seal(pid, pkey);
const outPath = join(outDir, "moss_vault.enc");
writeFileSync(outPath, JSON.stringify(sealed) + "\n", "utf8");
console.log(
  pid && pkey
    ? `sealed Moss vault → ${outPath} (credentials encrypted; not plaintext)`
    : `sealed empty Moss vault → ${outPath} (set MOSS_PROJECT_ID / MOSS_PROJECT_KEY to embed keys)`,
);
