#!/usr/bin/env node
/**
 * Writes resources/geo/dbip-country-lite.cidr from the DB-IP Lite country CSV.
 * The app does not download this itself. CC BY 4.0, https://db-ip.com/
 *
 *   node scripts/fetch-dbip-country.mjs
 *   node scripts/fetch-dbip-country.mjs ./dbip-country-lite.csv
 */
import { createWriteStream, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { createInterface } from 'node:readline'
import { Readable } from 'node:stream'
import { createGunzip } from 'node:zlib'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const out = join(here, '..', 'resources', 'geo', 'dbip-country-lite.cidr')
const month = new Date().toISOString().slice(0, 7)
const url = `https://download.db-ip.com/free/dbip-country-lite-${month}.csv.gz`

async function openInput() {
  const given = process.argv[2]
  if (given) {
    const { createReadStream } = await import('node:fs')
    const stream = createReadStream(given)
    return given.endsWith('.gz') ? stream.pipe(createGunzip()) : stream
  }
  const res = await fetch(url)
  if (!res.ok || !res.body) throw new Error(`download failed ${res.status} ${url}`)
  return Readable.fromWeb(res.body).pipe(createGunzip())
}

mkdirSync(dirname(out), { recursive: true })
const dest = createWriteStream(out)
dest.write(`# DB-IP Lite country ${month}. CC BY 4.0 https://db-ip.com/\n`)
let rows = 0
for await (const line of createInterface({ input: await openInput() })) {
  const parts = line.split(',')
  if (parts.length < 3) continue
  const [start, end, code] = parts
  if (!/^[A-Z]{2}$/.test(code) || code === 'ZZ') continue
  dest.write(`${start} ${end} ${code}\n`)
  rows += 1
}
await new Promise((resolve, reject) => dest.end((error) => (error ? reject(error) : resolve())))
console.error(`wrote ${rows} ranges to ${out}`)
