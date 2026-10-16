/**
 * Usage samples stay in the app data folder. The log line is the same counts the page shows.
 */
import { mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { aggregateUsage, appendSample, metricLine, usageCsv, type UsageReport, type UsageSample } from './metrics.js'

export class MetricsLog {
  private samples: UsageSample[] = []

  constructor(private readonly file: string, private readonly logFile: string) {
    this.samples = readSamples(file)
  }

  report(): UsageReport {
    return aggregateUsage(this.samples)
  }

  csv(): string {
    return usageCsv(this.samples)
  }

  record(sample: UsageSample): UsageReport {
    this.samples = appendSample(this.samples, sample)
    mkdirSync(dirname(this.file), { recursive: true })
    writeFileSync(this.file, JSON.stringify({ samples: this.samples }))
    mkdirSync(dirname(this.logFile), { recursive: true })
    appendFileSync(this.logFile, `${metricLine(sample)}\n`)
    return this.report()
  }

  reset(): UsageReport {
    this.samples = []
    mkdirSync(dirname(this.file), { recursive: true })
    writeFileSync(this.file, JSON.stringify({ samples: [] }))
    return this.report()
  }
}

function readSamples(file: string): UsageSample[] {
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as { samples?: UsageSample[] }
    return Array.isArray(parsed.samples) ? parsed.samples : []
  } catch {
    return []
  }
}
