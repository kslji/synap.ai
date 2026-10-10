import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import { agentCanOpen, parseAgentFile, sortAgents } from '../../../packages/shared/src/agents.ts'
import { AgentCards } from './AgentCards.tsx'

const root = new URL('../../..', import.meta.url).pathname
const banned = ['jellyfish', 'seahorse', 'octopus', 'SurfCrew', 'SurfMark', 'Jellyfish', 'Seahorse', 'Octopus']

function filesUnder(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist' || name === 'out') continue
    const path = join(dir, name)
    const stat = statSync(path)
    if (stat.isDirectory()) filesUnder(path, out)
    else if (/\.(tsx?|css|html|md)$/.test(name) && !name.endsWith('.test.ts')) out.push(path)
  }
  return out
}

test('old mascot names are gone from the app and the readme', () => {
  const paths = [
    ...filesUnder(join(root, 'apps')),
    ...filesUnder(join(root, 'packages', 'ui', 'src')),
    ...filesUnder(join(root, 'packages', 'shared', 'src')),
    join(root, 'README.md'),
  ]
  const hits: string[] = []
  for (const path of paths) {
    const text = readFileSync(path, 'utf8')
    for (const word of banned) {
      if (text.includes(word)) hits.push(`${path}: ${word}`)
    }
  }
  assert.deepEqual(hits, [])
})

test('system is not a theme option', () => {
  const theme = readFileSync(join(root, 'packages/ui/src/theme.ts'), 'utf8')
  const swatch = readFileSync(join(root, 'packages/ui/src/ThemeSwitch.tsx'), 'utf8')
  const tokens = readFileSync(join(root, 'packages/ui/src/tokens.css'), 'utf8')
  assert.match(theme, /export type ThemeChoice = 'light' \| 'dark'/)
  assert.doesNotMatch(swatch, /id: 'system'|System/)
  assert.doesNotMatch(tokens, /prefers-color-scheme/)
})

test('every agent.json has the required fields and the page renders one card each', () => {
  const dir = join(root, 'agents')
  const agents = sortAgents(readdirSync(dir).map((id) => parseAgentFile(id, JSON.parse(readFileSync(join(dir, id, 'agent.json'), 'utf8')))))
  assert.ok(agents.length >= 4)
  const html = renderToStaticMarkup(createElement(AgentCards, { agents }))
  const cards = html.match(/data-agent-card=/g) ?? []
  assert.equal(cards.length, agents.length)
  for (const agent of agents) {
    assert.ok(html.includes(`data-agent-card="${agent.id}"`), agent.id)
    assert.ok(html.includes(agent.name), agent.name)
    if (agentCanOpen(agent)) assert.match(html, /href="#download"/)
  }
  const closed = agents.filter((agent) => !agentCanOpen(agent))
  assert.ok(closed.length >= 3)
  assert.equal(agents.filter((agent) => agent.status === 'available').map((agent) => agent.id).join(','), 'general')
})
