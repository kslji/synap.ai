/**
 * On-device text from a screenshot. Used when the projector is absent
 * and when the picture is mostly text, such as an error dialog.
 */

const ERROR_LINE = /^(?:.*\b(?:TypeError|ReferenceError|SyntaxError|AssertionError|Error|Exception|Traceback|FAILED|FAIL)|error TS\d+|File ".+", line \d+).*$/i

export function isTextHeavy(input: { text: string; confidence: number; width: number; height: number }): boolean {
  const letters = (input.text.match(/[A-Za-z0-9]/g) ?? []).length
  const lines = input.text.split(/\n/).map((line) => line.trim()).filter(Boolean)
  if (input.confidence >= 55 && letters >= 24 && lines.length >= 2) return true
  const area = Math.max(1, input.width * input.height)
  return letters >= 40 && letters / area > 0.0008
}

/** Keep error lines and stack frames. Other prose stays out of the fix loop. */
export function extractErrorText(raw: string): string {
  const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  const kept: string[] = []
  for (const line of lines) {
    if (ERROR_LINE.test(line) || /^\s*at \S+:\d+/.test(line) || /^at .+\(.+:\d+:\d+\)$/.test(line)) {
      kept.push(line)
    }
  }
  return kept.join('\n')
}

export function ocrFallbackChoice(input: {
  textHeavy: boolean
  mmprojInstalled: boolean
  runtimeSupports: boolean
  ramOk: boolean
}): 'ocr' | 'vision' {
  if (input.textHeavy || !input.mmprojInstalled || !input.runtimeSupports || !input.ramOk) return 'ocr'
  return 'vision'
}
