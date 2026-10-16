/**
 * llama.cpp multimodal (libmtmd / --mmproj). Detection and the fallback plan
 * stay in code. A build without the flag never receives --mmproj.
 */
export type MmprojReason = 'on' | 'runtime' | 'missing' | 'ram' | 'blocked'

export function runtimeSupportsMmproj(helpText: string): boolean {
  return /--mmproj\b/.test(helpText) || /\blibmtmd\b/.test(helpText)
}

export function mmprojServerArgs(enabled: boolean, filePath: string): string[] {
  if (!enabled || !filePath) return []
  return ['--mmproj', filePath]
}

export function visionLoadDecision(input: {
  runtimeSupports: boolean
  installed: boolean
  ramOk: boolean
  blocked: boolean
}): { load: boolean; reason: MmprojReason } {
  if (input.blocked) return { load: false, reason: 'blocked' }
  if (!input.runtimeSupports) return { load: false, reason: 'runtime' }
  if (!input.ramOk) return { load: false, reason: 'ram' }
  if (!input.installed) return { load: false, reason: 'missing' }
  return { load: true, reason: 'on' }
}

/** After a failed start, drop the draft model first, then the vision projector. */
export function nextVisionAttempt(failed: { mmproj: string; draft: string }): { mmproj: string; draft: string } | null {
  if (failed.draft) return { mmproj: failed.mmproj, draft: '' }
  if (failed.mmproj) return { mmproj: '', draft: '' }
  return null
}
