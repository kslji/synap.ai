/**
 * Process RSS for llama-server. Linux reads /proc. Other systems use ps.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

export function readRssMb(pid: number): number | null {
  if (!pid) return null
  try {
    if (process.platform === 'linux') {
      const text = readFileSync(`/proc/${pid}/status`, 'utf8')
      const kb = Number(text.match(/^VmRSS:\s+(\d+)/m)?.[1])
      return Number.isFinite(kb) && kb > 0 ? kb / 1024 : null
    }
    const out = execFileSync('ps', ['-o', 'rss=', '-p', String(pid)], { encoding: 'utf8' }).trim()
    const kb = Number(out.split(/\s+/)[0])
    return Number.isFinite(kb) && kb > 0 ? kb / 1024 : null
  } catch {
    return null
  }
}

export function availableRamGb(): number | null {
  try {
    if (process.platform !== 'linux') return null
    const text = readFileSync('/proc/meminfo', 'utf8')
    const kb = Number(text.match(/^MemAvailable:\s+(\d+)/m)?.[1])
    return Number.isFinite(kb) ? kb / 1024 / 1024 : null
  } catch {
    return null
  }
}

export function watchRss(pid: () => number | undefined, everyMs = 250): { peak: () => number; stop: () => number } {
  let peakMb = 0
  const sample = () => {
    const id = pid()
    if (!id) return
    const rss = readRssMb(id)
    if (rss != null && rss > peakMb) peakMb = rss
  }
  const timer = setInterval(sample, everyMs)
  timer.unref?.()
  return {
    peak: () => peakMb,
    stop: () => {
      clearInterval(timer)
      sample()
      return peakMb
    },
  }
}
