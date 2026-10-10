import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import JSZip from 'jszip'
import { extractArchive } from './fetch-sidecars.mjs'

test('extracts a zip with JSZip and rejects entries that leave the folder', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'surf-zip-'))
  try {
    const zip = new JSZip()
    zip.file('llama-b1/llama-server.txt', 'hello')
    const buf = await zip.generateAsync({ type: 'nodebuffer' })
    const archive = join(dir, 'llama.zip')
    writeFileSync(archive, buf)
    await extractArchive(archive, buf, dir)
    assert.equal(readFileSync(join(dir, 'llama-b1', 'llama-server.txt'), 'utf8'), 'hello')

    const slip = new JSZip()
    slip.file('../nope.txt', 'x')
    const slipBuf = await slip.generateAsync({ type: 'nodebuffer' })
    await assert.rejects(() => extractArchive(join(dir, 'bad.zip'), slipBuf, dir), /escapes/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('still extracts tar.gz with tar', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'surf-tar-'))
  try {
    const nested = join(dir, 'src')
    execFileSync('mkdir', ['-p', nested])
    writeFileSync(join(nested, 'note.txt'), 'tar-ok')
    const archive = join(dir, 'sidecar.tar.gz')
    execFileSync('tar', ['-czf', archive, '-C', dir, 'src'])
    const out = join(dir, 'out')
    execFileSync('mkdir', ['-p', out])
    await extractArchive(archive, readFileSync(archive), out)
    assert.equal(readFileSync(join(out, 'src', 'note.txt'), 'utf8'), 'tar-ok')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
