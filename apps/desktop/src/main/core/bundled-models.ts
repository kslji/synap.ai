/**
 * Models shipped beside the app in an offline zip. A missing or tampered
 * manifest is ignored, and the first open falls through to the picker.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { acceptBundledManifest, type BundledManifest } from '../../shared/offline-pack.js'
import { setupCatalog, setupEmbedding, type SetupEmbed, type SetupModel } from '../../shared/setup-choice.js'

type RegistryRow = Parameters<typeof setupCatalog>[0][number] & { role?: string }

export function bundledSourcePath(resourcesPath: string, file: string): string | null {
  if (!/^[A-Za-z0-9._-]+$/.test(file)) return null
  return join(resourcesPath, 'setup-models', file)
}

export function readBundledManifest(resourcesPath: string, models: readonly RegistryRow[]): BundledManifest | null {
  const path = join(resourcesPath, 'setup-models', 'manifest.json')
  if (!existsSync(path)) return null
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as unknown
    const catalog: SetupModel[] = setupCatalog(models)
    const embedding: SetupEmbed | null = setupEmbedding(models)
    return acceptBundledManifest(raw, catalog, embedding)
  } catch {
    return null
  }
}
