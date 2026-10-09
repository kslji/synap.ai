/**
 * Verify a downloaded knowledge pack BEFORE opening it (main process).
 * Format (written by code-samples/build_pack.py):
 *   manifest.json  - exact bytes are signed; lists files with size + sha256
 *   manifest.sig   - 64-byte raw Ed25519 signature over manifest.json
 * Uses Node's built-in crypto (Ed25519 is supported natively; no extra dependency).
 * @noble/ed25519 is a pure-JS alternative if you ever need the same code in a browser.
 * Raw 32-byte public keys are compatible with minisign/libsodium/PyNaCl keys.
 */
import { createHash, createPublicKey, verify as edVerify, type KeyObject } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { z } from 'zod';
import { specKey, type EmbeddingSpec } from './embedding.js';

export const PackManifest = z.object({
  // surf-pack/1 is the product id. harbor-pack/1 is still accepted so the verified code samples keep working until the pipeline is renamed.
  format: z.union([z.literal('surf-pack/1'), z.literal('harbor-pack/1')]),
  pack_id: z.string().regex(/^[a-z0-9][a-z0-9-]{1,62}$/),
  niche: z.string(),
  version: z.string().regex(/^\d{4}\.\d{2}\.\d{2}(\.\d+)?$/),
  previous_version: z.string().nullable().optional(),
  created_at: z.string(),
  min_app_version: z.string(),
  /** Must match the app's EmbeddingSpec exactly (id, dim, pooling, prefixes) - see embedding.ts. */
  embedding: z.object({
    id: z.string(), model: z.string(), file: z.string(), native_dim: z.number().int(), dim: z.number().int(),
    pooling: z.string(), normalize: z.boolean(), query_prefix: z.string(), doc_template: z.string(),
  }),
  chunking: z.object({ target_tokens: z.number().int(), overlap_tokens: z.number().int() }),
  files: z.array(z.object({
    name: z.string(),
    role: z.enum(['index', 'attribution']),
    size: z.number().int().nonnegative(),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
    url: z.string().url(),
    compression: z.enum(['none', 'zstd']).optional(),
  })).min(1),
  signing_key_id: z.string(),
}).passthrough();
export type PackManifest = z.infer<typeof PackManifest>;

/** Public keys compiled into the app, by key id. Two slots allow key rotation without breaking old packs. */
export type TrustedKeys = Record<string, string /* 64 hex chars */>;

export function ed25519PublicKey(hex: string): KeyObject {
  const raw = Buffer.from(hex, 'hex');
  if (raw.length !== 32) throw new Error('Ed25519 public key must be 32 bytes');
  return createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: raw.toString('base64url') }, format: 'jwk' });
}

export async function sha256File(path: string): Promise<string> {
  const h = createHash('sha256');
  for await (const chunk of createReadStream(path)) h.update(chunk as Buffer);
  return h.digest('hex');
}

export interface VerifyOptions {
  trustedKeys: TrustedKeys;
  expectedEmbedding: EmbeddingSpec; // the spec the desktop uses for queries; any difference -> refuse
  installedVersion?: string; //   refuse downgrades (replay of an old, valid pack)
}

/** Compare "YYYY.MM.DD[.N]" versions numerically. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number), pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return Math.sign(d);
  }
  return 0;
}

export async function verifyPack(dir: string, opts: VerifyOptions): Promise<PackManifest> {
  const body = await readFile(join(dir, 'manifest.json'));
  const sig = await readFile(join(dir, 'manifest.sig'));
  if (sig.length !== 64) throw new Error('manifest.sig must be 64 bytes');

  // 1) signature over the exact bytes, BEFORE parsing anything
  const keyId = (JSON.parse(body.toString('utf8')) as { signing_key_id?: unknown }).signing_key_id;
  const keyHex = typeof keyId === 'string' ? opts.trustedKeys[keyId] : undefined;
  if (!keyHex) throw new Error(`unknown signing key id ${String(keyId)}`);
  if (!edVerify(null, body, ed25519PublicKey(keyHex), sig)) throw new Error('bad pack signature');

  // 2) schema + policy checks
  const m = PackManifest.parse(JSON.parse(body.toString('utf8')));
  const e = m.embedding, want = opts.expectedEmbedding;
  const got = specKey({ id: e.id, dim: e.dim, pooling: e.pooling as 'mean', queryPrefix: e.query_prefix, docTemplate: e.doc_template });
  if (got !== specKey(want)) {
    throw new Error(`pack embedding spec ${e.id}/${e.dim}d does not match app ${want.id}/${want.dim}d - re-index or update the app`);
  }
  if (opts.installedVersion && compareVersions(m.version, opts.installedVersion) <= 0) {
    throw new Error(`pack ${m.version} is not newer than installed ${opts.installedVersion}`);
  }

  // 3) every file: no path tricks, exact size, exact hash
  for (const f of m.files) {
    if (basename(f.name) !== f.name) throw new Error(`illegal file name ${f.name}`);
    const p = join(dir, f.name);
    const st = await stat(p);
    if (st.size !== f.size) throw new Error(`${f.name}: size ${st.size} != ${f.size}`);
    const digest = await sha256File(p);
    if (digest !== f.sha256) throw new Error(`${f.name}: sha256 mismatch`);
  }
  return m;
}
