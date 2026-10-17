import { basename } from 'node:path'
import { LOCAL_CHAT_MODEL_ID } from '../../shared/starter-model.js'

export interface RegistryFile {
  id: string
  role: string
  size_bytes: number
  file: string
}

/** Remembered path for a GGUF the user already has. `file` is the registry name, or the absolute path for an unknown file. */
export interface LocalGgufPointer {
  path: string
  bytes: number
  name: string
  modelId: string
  file: string
}

export function isGgufName(filePath: string): boolean {
  return filePath.toLowerCase().endsWith('.gguf')
}

/** A chat row with the same byte size is that model. Anything else is a local file the server can still load. */
export function planLocalGguf(input: { sourcePath: string; bytes: number; models: readonly RegistryFile[] }): LocalGgufPointer {
  const name = basename(input.sourcePath) || 'model.gguf'
  const match = input.models.find((model) => model.role === 'chat' && model.size_bytes === input.bytes)
  if (match) {
    return { path: input.sourcePath, bytes: input.bytes, name, modelId: match.id, file: match.file }
  }
  return { path: input.sourcePath, bytes: input.bytes, name, modelId: LOCAL_CHAT_MODEL_ID, file: input.sourcePath }
}

export function parseLocalPointer(raw: unknown): LocalGgufPointer | null {
  if (!raw || typeof raw !== 'object') return null
  const row = raw as Partial<LocalGgufPointer>
  if (typeof row.path !== 'string' || !isGgufName(row.path)) return null
  if (typeof row.file !== 'string' || !row.file) return null
  if (typeof row.modelId !== 'string' || !row.modelId) return null
  if (typeof row.bytes !== 'number' || !Number.isFinite(row.bytes) || row.bytes <= 0) return null
  return {
    path: row.path,
    bytes: row.bytes,
    name: typeof row.name === 'string' && row.name ? row.name : basename(row.path),
    modelId: row.modelId,
    file: row.file,
  }
}
