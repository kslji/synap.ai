import assert from 'node:assert/strict'
import test from 'node:test'
import { WHISPER_TAG, whisperAsset, whisperUrl } from './fetch-whisper.mjs'

test('whisper.cpp uses the pinned b5454 archives and builds macOS from that tag', () => {
  assert.equal(WHISPER_TAG, 'b5454')
  assert.equal(whisperAsset('linux', 'x64'), 'whisper-bin-ubuntu-x64.tar.gz')
  assert.equal(whisperAsset('linux', 'arm64'), 'whisper-bin-ubuntu-arm64.tar.gz')
  assert.equal(whisperAsset('win32', 'x64'), 'whisper-bin-x64.zip')
  assert.equal(whisperAsset('win32', 'arm64'), 'whisper-bin-win-cpu-arm64.zip')
  assert.equal(whisperAsset('darwin', 'arm64'), null)
  assert.equal(whisperAsset('darwin', 'x64'), null)
  assert.equal(
    whisperUrl('whisper-bin-ubuntu-x64.tar.gz'),
    'https://github.com/ggml-org/whisper.cpp/releases/download/b5454/whisper-bin-ubuntu-x64.tar.gz',
  )
})
