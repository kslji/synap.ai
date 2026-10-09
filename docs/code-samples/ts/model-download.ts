/**
 * First-launch model download (main process): resumable (HTTP Range), verified (size + SHA-256),
 * atomic (".part" file renamed only after the hash matches). Models are NOT bundled in the installer.
 * In Electron prefer `net.fetch` (uses the OS proxy settings) - same API as global fetch used here.
 */
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync } from 'node:fs';
import { rename, stat, unlink, statfs } from 'node:fs/promises';
import { dirname } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

export interface DownloadSpec { url: string; dest: string; size: number; sha256: string }
export type Progress = (done: number, total: number) => void;

async function hashExisting(path: string): Promise<{ hash: ReturnType<typeof createHash>; bytes: number }> {
  const hash = createHash('sha256');
  let bytes = 0;
  if (existsSync(path)) {
    for await (const c of createReadStream(path)) { hash.update(c as Buffer); bytes += (c as Buffer).length; }
  }
  return { hash, bytes };
}

export async function downloadVerified(spec: DownloadSpec, onProgress?: Progress, signal?: AbortSignal,
  fetchImpl: typeof fetch = fetch): Promise<string> {
  if (existsSync(spec.dest) && (await stat(spec.dest)).size === spec.size) return spec.dest; // already verified earlier
  const fsInfo = await statfs(dirname(spec.dest));
  if (fsInfo.bavail * fsInfo.bsize < spec.size * 1.05) throw new Error('not enough free disk space');

  const part = spec.dest + '.part';
  let { hash, bytes } = await hashExisting(part); // resume: re-hash what we already have
  if (bytes > spec.size) { await unlink(part); ({ hash, bytes } = await hashExisting(part)); }

  if (bytes < spec.size) {
    const res = await fetchImpl(spec.url, { headers: bytes ? { Range: `bytes=${bytes}-` } : {}, redirect: 'follow', signal });
    if (bytes && res.status === 200) { // server ignored Range -> restart from zero
      await unlink(part); ({ hash, bytes } = await hashExisting(part));
    } else if (!res.ok) {
      throw new Error(`download failed: HTTP ${res.status}`);
    }
    if (!res.body) throw new Error('empty body');
    let done = bytes;
    const meter = new Transform({
      transform(chunk: Buffer, _enc, cb) {
        hash.update(chunk);
        done += chunk.length;
        onProgress?.(done, spec.size);
        cb(null, chunk);
      },
    });
    await pipeline(Readable.fromWeb(res.body as import('node:stream/web').ReadableStream), meter,
      createWriteStream(part, { flags: bytes ? 'a' : 'w' }), { signal });
    bytes = done;
  }
  if (bytes !== spec.size) throw new Error(`size mismatch: got ${bytes}, expected ${spec.size}`);
  const digest = hash.digest('hex');
  if (digest !== spec.sha256) { await unlink(part); throw new Error('sha256 mismatch - file deleted, retry'); }
  await rename(part, spec.dest);
  return spec.dest;
}
