/**
 * In-app Code knowledge pack. The folder lives in the app's private data directory.
 * The manifest is signature-checked before anything in it is trusted.
 * Pack bytes come later; an empty file list is a valid stub.
 */
import { verify as edVerify } from 'node:crypto'
import { existsSync } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { z } from 'zod'
import { ed25519PublicKey, sha256File, type TrustedKeys } from './pack-verify.js'

export const CodePackManifest = z.object({
  format: z.literal('surf-code-pack/1'),
  pack_id: z.literal('code'),
  version: z.string().regex(/^\d{4}\.\d{2}\.\d{2}(\.\d+)?$/),
  created_at: z.string(),
  min_app_version: z.string(),
  signing_key_id: z.string(),
  notes: z.string().optional(),
  files: z.array(z.object({
    name: z.string(),
    size: z.number().int().nonnegative(),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
  })).default([]),
}).passthrough()
export type CodePackManifest = z.infer<typeof CodePackManifest>

export function codePackDir(userData: string): string {
  return join(userData, 'code-pack')
}

export type CodePackLoad =
  | { status: 'absent' }
  | { status: 'ready'; manifest: CodePackManifest }
  | { status: 'invalid'; message: string }

/** Read `userData/code-pack` when it exists. A missing folder is not an error. */
export async function loadCodePack(dir: string, trustedKeys: TrustedKeys): Promise<CodePackLoad> {
  const manifestPath = join(dir, 'manifest.json')
  if (!existsSync(manifestPath)) return { status: 'absent' }
  try {
    const body = await readFile(manifestPath)
    const sigPath = join(dir, 'manifest.sig')
    if (!existsSync(sigPath)) return { status: 'invalid', message: 'code pack is missing manifest.sig' }
    const sig = await readFile(sigPath)
    if (sig.length !== 64) return { status: 'invalid', message: 'manifest.sig must be 64 bytes' }
    const keyId = (JSON.parse(body.toString('utf8')) as { signing_key_id?: unknown }).signing_key_id
    const keyHex = typeof keyId === 'string' ? trustedKeys[keyId] : undefined
    if (!keyHex) return { status: 'invalid', message: `unknown signing key id ${String(keyId)}` }
    if (!edVerify(null, body, ed25519PublicKey(keyHex), sig)) return { status: 'invalid', message: 'bad code pack signature' }
    const manifest = CodePackManifest.parse(JSON.parse(body.toString('utf8')))
    for (const file of manifest.files) {
      if (basename(file.name) !== file.name) return { status: 'invalid', message: `illegal file name ${file.name}` }
      const path = join(dir, file.name)
      const info = await stat(path)
      if (info.size !== file.size) return { status: 'invalid', message: `${file.name}: size mismatch` }
      const digest = await sha256File(path)
      if (digest !== file.sha256) return { status: 'invalid', message: `${file.name}: sha256 mismatch` }
    }
    return { status: 'ready', manifest }
  } catch (error) {
    return { status: 'invalid', message: (error as Error).message }
  }
}
