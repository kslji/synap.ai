/**
 * Fill-in-the-middle suggestions. A second llama-server is started only when the
 * coder GGUF is on disk and the machine has enough RAM. The chat server is left alone.
 */
import { existsSync } from 'node:fs'
import { fimPrompt } from './triage.js'

export const FIM_MIN_RAM_GB = 4
export const FIM_MODEL_ID = 'qwen2.5-coder-1.5b-q8_0'

export function fimCanStart(opts: { modelPath: string; totalRamGb: number }): { ok: boolean; reason: string } {
  if (!opts.modelPath || !existsSync(opts.modelPath)) {
    return { ok: false, reason: 'Download Qwen2.5 Coder 1.5B to turn on suggestions.' }
  }
  if (opts.totalRamGb < FIM_MIN_RAM_GB) {
    return { ok: false, reason: 'Not enough free RAM for a second model.' }
  }
  return { ok: true, reason: '' }
}

export async function fimComplete(baseUrl: string, apiKey: string, prefix: string, suffix: string, fetchImpl: typeof fetch = fetch): Promise<string> {
  const res = await fetchImpl(`${baseUrl.replace(/\/$/, '')}/v1/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model: 'fim', prompt: fimPrompt(prefix, suffix), max_tokens: 48, temperature: 0 }),
  })
  if (!res.ok) throw new Error(`completion failed (${res.status})`)
  const body = await res.json() as { choices?: { text?: string }[] }
  return (body.choices?.[0]?.text ?? '').split('\n')[0] ?? ''
}
