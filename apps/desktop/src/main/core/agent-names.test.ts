import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { readAgentName } from './agent-names.js'

test('an agent folder supplies the chat name', () => {
  const root = mkdtempSync(join(tmpdir(), 'surf-agents-'))
  try {
    mkdirSync(join(root, 'pilot'))
    writeFileSync(join(root, 'pilot', 'agent.json'), JSON.stringify({ name: 'Pilot' }))
    assert.equal(readAgentName('pilot', [root]), 'Pilot')
    assert.equal(readAgentName('marine', [root]), null)
    assert.equal(readAgentName('../general', [root]), null)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
