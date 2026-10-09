/**
 * Hardware detection + tier selection (main process). os gives RAM/CPU; systeminformation gives GPUs/VRAM.
 * Tiers (see ARCHITECTURE.md section 11):
 *   0: < 8 GB RAM      -> Qwen3.5-2B   (fallback, limited quality)
 *   1: 8-15 GB         -> Qwen3.5-4B
 *   2: 16-31 GB        -> Qwen3.5-9B
 *   3: >= 32 GB or GPU with >= 12 GB VRAM -> Qwen3.5-9B with larger context / whisper large-v3-turbo
 */
import os from 'node:os';
import si from 'systeminformation';

export interface HardwareInfo {
  platform: NodeJS.Platform;
  arch: string;
  totalRamGb: number;
  freeRamGb: number;
  cpuModel: string;
  physicalCores: number;
  gpus: { vendor: string; model: string; vramMb: number | null }[];
  appleSilicon: boolean;
  tier: 0 | 1 | 2 | 3;
}

export function tierFor(totalRamGb: number, maxVramGb: number, appleSilicon: boolean): 0 | 1 | 2 | 3 {
  // os.totalmem() reports slightly less than the marketing size (e.g. 15.6 for "16 GB"), hence the margins.
  if (totalRamGb >= 31 || (!appleSilicon && maxVramGb >= 12)) return 3;
  if (totalRamGb >= 15) return 2;
  if (totalRamGb >= 7.3) return 1;
  return 0;
}

export async function detectHardware(): Promise<HardwareInfo> {
  const totalRamGb = os.totalmem() / 1024 ** 3;
  const freeRamGb = os.freemem() / 1024 ** 3;
  const cpus = os.cpus();
  let physicalCores = Math.max(1, Math.floor(cpus.length / 2));
  let gpus: HardwareInfo['gpus'] = [];
  try {
    const [cpu, g] = await Promise.all([si.cpu(), si.graphics()]);
    physicalCores = cpu.physicalCores || physicalCores;
    gpus = g.controllers.map((c) => ({ vendor: c.vendor, model: c.model, vramMb: c.vram ?? null }));
  } catch {
    /* systeminformation can fail in locked-down environments; RAM-only tiering still works */
  }
  const appleSilicon = process.platform === 'darwin' && process.arch === 'arm64';
  const maxVramGb = Math.max(0, ...gpus.map((g) => (g.vramMb ?? 0) / 1024));
  return {
    platform: process.platform,
    arch: process.arch,
    totalRamGb: Math.round(totalRamGb * 10) / 10,
    freeRamGb: Math.round(freeRamGb * 10) / 10,
    cpuModel: cpus[0]?.model ?? 'unknown',
    physicalCores,
    gpus,
    appleSilicon,
    tier: tierFor(totalRamGb, maxVramGb, appleSilicon),
  };
}

/** Threads for llama-server: leave one core for the UI and main process. */
export const chatThreads = (hw: HardwareInfo): number => Math.max(1, hw.physicalCores - 1);
