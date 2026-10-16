/**
 * Wires the completion service to the local model, CodeIndex, the editor file API, and loopback HTTP.
 * suggest() never writes a project file. save() is a separate user action.
 */
import { unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { CodeIndex } from '../../code/project.js'
import type { SymbolHit } from '../../code/store.js'
import { CodeCompleteReq } from '../../ipc-schemas.js'
import { listEditorFiles, readEditorFile, saveEditorFile, type EditorFile } from './editor-files.js'
import { fimMarkerTokens, llamaComplete } from './llama-complete.js'
import { HttpStatus, startCompletionHttp, type CompletionEndpoint } from './http-api.js'
import { languageSuggestionsOn } from './policy.js'
import { CompletionService, type CompletionInput, type CompletionResult } from './service.js'
import type { IndexedSnippet } from './snippets.js'

export interface CompletionServer {
  baseUrl: string
  apiKey: string
}

export interface CompletionRuntime {
  suggest(input: CompletionInput): Promise<CompletionResult>
  files(): EditorFile[]
  read(path: string): { path: string; language: string; text: string }
  save(path: string, text: string): { path: string }
  endpoint(): { port: number }
  close(): Promise<void>
}

export function createCompletionRuntime(opts: {
  userData: string
  enabled(): boolean
  languagesOff(): readonly string[]
  modelId(): string
  root(): string | null
  indexed(): CodeIndex | null
  /** Starts the local model when one is installed. Null means completions stay empty. */
  server(): Promise<CompletionServer | null>
  log?: (line: string) => void
}): CompletionRuntime {
  let endpoint: CompletionEndpoint | null = null
  let probed: { id: string; tokens: number | null } | null = null
  const log = opts.log ?? ((line: string) => console.info(line))
  const service = new CompletionService({
    enabled: opts.enabled,
    languageOn: (language) => languageSuggestionsOn(language, opts.languagesOff()),
    modelId: opts.modelId,
    probeFim: async (signal) => {
      const id = opts.modelId()
      if (probed?.id === id) return probed.tokens
      const server = await opts.server()
      if (!server || signal.aborted) return null
      try {
        const tokens = await fimMarkerTokens(server.baseUrl, server.apiKey, signal)
        probed = { id, tokens }
        return tokens
      } catch (error) {
        if (signal.aborted) return null
        log(`[surf] completion fim probe failed status=${statusOf(error)}`)
        probed = { id, tokens: null }
        return null
      }
    },
    complete: async (req) => {
      const server = await opts.server()
      if (!server || req.signal.aborted) return ''
      try {
        return await llamaComplete(server.baseUrl, server.apiKey, req)
      } catch (error) {
        if (req.signal.aborted) return ''
        log(`[surf] completion model failed status=${statusOf(error)}`)
        return ''
      }
    },
    snippets: async (path, line) => {
      const index = opts.indexed()
      if (!index) return { imported: [], nearby: [] }
      try {
        const hints = await index.completionHints(path, line)
        return { imported: hints.imported.map(asSnippet('import')), nearby: hints.nearby.map(asSnippet('nearby')) }
      } catch {
        log('[surf] completion snippets failed')
        return { imported: [], nearby: [] }
      }
    },
    log,
  })

  void startCompletionHttp(async (body) => {
    const parsed = CodeCompleteReq.safeParse(body)
    if (!parsed.success) throw new HttpStatus(400, 'invalid completion request')
    return service.suggest(parsed.data)
  }).then((started) => {
    endpoint = started
    const file = join(opts.userData, 'completion-api.json')
    writeFileSync(file, JSON.stringify({ host: '127.0.0.1', port: started.port, token: started.token }), { mode: 0o600 })
    log(`[surf] completion api port=${started.port}`)
  }).catch((error: unknown) => {
    log(`[surf] completion api failed: ${(error as Error).message}`)
  })

  function requireRoot(): string {
    const root = opts.root()
    if (!root) throw new Error('Open a project folder first.')
    return root
  }

  return {
    suggest: (input) => service.suggest(input),
    files: () => listEditorFiles(requireRoot()),
    read: (path) => readEditorFile(requireRoot(), path),
    save: (path, text) => saveEditorFile(requireRoot(), path, text),
    endpoint: () => ({ port: endpoint?.port ?? 0 }),
    close: async () => {
      const current = endpoint
      endpoint = null
      try { unlinkSync(join(opts.userData, 'completion-api.json')) } catch { /* not written */ }
      await current?.close()
    },
  }
}

function asSnippet(reason: IndexedSnippet['reason']): (hit: SymbolHit) => IndexedSnippet {
  return (hit) => ({
    path: hit.path,
    symbol: hit.qualified || hit.name,
    text: hit.text || hit.signature,
    reason,
  })
}

function statusOf(error: unknown): string {
  const message = error instanceof Error ? error.message : ''
  const match = /HTTP (\d+)/.exec(message)
  return match?.[1] ?? 'error'
}
