/**
 * OCR is the screenshot path when mmproj is not installed, and for text-heavy images.
 * Error lines are chosen here. The model does not decide which line is the error.
 */
export interface OcrRead {
  text: string
  confidence: number
}

const ERROR_WORD = /\b(TypeError|ReferenceError|SyntaxError|AssertionError|Exception|Traceback|FAILED|Error|panic)\b/i
const AT_LINE = /^at\s+\S+/
const PY_LINE = /File ".+", line \d+/

export function extractErrorLines(text: string): string[] {
  const out: string[] = []
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) continue
    if (ERROR_WORD.test(line) || AT_LINE.test(line) || PY_LINE.test(line)) {
      if (!out.includes(line)) out.push(line)
    }
    if (out.length >= 12) break
  }
  return out
}

export function isTextHeavy(text: string, confidence: number): boolean {
  const letters = text.replace(/\s+/g, '').length
  if (letters < 8) return false
  if (extractErrorLines(text).length > 0 && confidence >= 40) return true
  return letters >= 48 && confidence >= 55
}

export function ocrInsteadOfModel(input: { mmprojAvailable: boolean; textHeavy: boolean }): boolean {
  if (!input.mmprojAvailable) return true
  return input.textHeavy
}
