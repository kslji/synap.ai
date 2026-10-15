/**
 * Code agent file-size caps from system RAM (os.totalmem, passed in as gigabytes).
 * VRAM does not raise the cap. Decimal GB: 2 GB = 2_000_000_000 bytes.
 *   4 GB laptop  → model file up to 2 GB
 *   8 GB laptop  → model file up to 3 GB
 *   16 GB laptop → model file up to 4 GB
 *   32 GB laptop → model file up to 8 GB
 * os.totalmem() reports a bit under the marketing size, so 15.6 counts as 16 GB.
 */
export type LaptopRamClass = 4 | 8 | 16 | 32
export type CodeFit = 'recommended' | 'fits' | 'too-big'

export const CODE_FILE_CAPS: readonly { laptopRamGb: LaptopRamClass; maxFileBytes: number }[] = [
  { laptopRamGb: 4, maxFileBytes: 2_000_000_000 },
  { laptopRamGb: 8, maxFileBytes: 3_000_000_000 },
  { laptopRamGb: 16, maxFileBytes: 4_000_000_000 },
  { laptopRamGb: 32, maxFileBytes: 8_000_000_000 },
]

export function laptopRamClass(totalRamGb: number): LaptopRamClass {
  if (totalRamGb >= 31) return 32
  if (totalRamGb >= 15) return 16
  if (totalRamGb >= 7.3) return 8
  return 4
}

export function codeFileCapBytes(totalRamGb: number): number {
  const klass = laptopRamClass(totalRamGb)
  return CODE_FILE_CAPS.find((row) => row.laptopRamGb === klass)!.maxFileBytes
}

/** Smallest laptop class whose file cap holds this GGUF. Null when the file is over 8 GB. */
export function ramTierForFile(sizeBytes: number): LaptopRamClass | null {
  const hit = CODE_FILE_CAPS.find((row) => sizeBytes <= row.maxFileBytes)
  return hit?.laptopRamGb ?? null
}

/** A Code row is listed when its RAM tier is this laptop's class or smaller. */
export function offeredOnLaptop(minRamGb: number, totalRamGb: number): boolean {
  return minRamGb <= laptopRamClass(totalRamGb)
}

/**
 * Qwen3.5 2B is Recommended on every laptop. Other rows for this RAM class are Fits.
 * A higher tier is Too big and is left off the list. Gemma E2B starts at 8 GB.
 */
export function codeFitMark(
  model: { family: string; minRamGb: number; defaultFor?: readonly string[] },
  totalRamGb: number,
): CodeFit {
  if (model.family === 'qwen3.5' && model.defaultFor?.includes('code')) return 'recommended'
  if (offeredOnLaptop(model.minRamGb, totalRamGb)) return 'fits'
  return 'too-big'
}
