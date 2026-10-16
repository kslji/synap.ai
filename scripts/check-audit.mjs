/**
 * Fail on high or critical advisories that are not already listed.
 * The allowlist is the set of advisories present before this change.
 */
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

const allow = JSON.parse(readFileSync(new URL('./audit-allow.json', import.meta.url), 'utf8'))
const npmAllow = new Set(allow.npm ?? [])
const pipAllow = new Set(allow.pip ?? [])

function npmAdvisories() {
  const run = spawnSync('npm', ['audit', '--json'], { encoding: 'utf8' })
  const text = run.stdout || '{}'
  let report
  try { report = JSON.parse(text) } catch { throw new Error(`npm audit did not return JSON\n${text.slice(0, 500)}`) }
  const found = []
  for (const [name, info] of Object.entries(report.vulnerabilities ?? {})) {
    if (info.severity !== 'high' && info.severity !== 'critical') continue
    const vias = Array.isArray(info.via) ? info.via : []
    const ids = vias.map((via) => (typeof via === 'object' && via ? String(via.url || via.source || name) : String(via)))
    const id = ids.find((item) => item.startsWith('http') || item.startsWith('GHSA')) || `${name}:${info.severity}`
    found.push(id)
  }
  return found
}

function pipAdvisories() {
  const run = spawnSync('python3', ['-m', 'pip_audit', '-f', 'json', '--progress-spinner', 'off'], { encoding: 'utf8' })
  if (run.error && run.error.code === 'ENOENT') throw new Error('pip-audit is not installed')
  const text = run.stdout || '[]'
  let rows
  try { rows = JSON.parse(text) } catch { throw new Error(`pip-audit did not return JSON\n${(run.stderr || text).slice(0, 500)}`) }
  const dependencies = Array.isArray(rows) ? rows : rows.dependencies ?? []
  const found = []
  for (const dep of dependencies) {
    for (const vuln of dep.vulns ?? []) {
      found.push(String(vuln.id || `${dep.name}:${vuln.fix_versions}`))
    }
  }
  return found
}

const npmFound = npmAdvisories()
const pipFound = pipAdvisories()
const npmNew = npmFound.filter((id) => !npmAllow.has(id))
const pipNew = pipFound.filter((id) => !pipAllow.has(id))
if (npmNew.length || pipNew.length) {
  console.error(JSON.stringify({ npmNew, pipNew }, null, 2))
  process.exit(1)
}
console.log(`audit ok npm=${npmFound.length} pip=${pipFound.length}`)
