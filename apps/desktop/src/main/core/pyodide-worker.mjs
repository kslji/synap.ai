/**
 * Pyodide worker. The host passes indexURL and a SharedArrayBuffer interrupt.
 * User code has no fetch and Python network modules are blocked.
 */
import { loadPyodide } from 'pyodide'
import { parentPort, workerData } from 'node:worker_threads'

const port = parentPort
if (!port) throw new Error('pyodide worker needs a parent')

globalThis.fetch = undefined

const pyodide = await loadPyodide({ indexURL: workerData.indexURL })
if (workerData.interrupt) pyodide.setInterruptBuffer(workerData.interrupt)
pyodide.runPython(`
import sys
class _Blocked:
    def __getattr__(self, name):
        raise RuntimeError('network disabled')
for _name in ('socket', 'urllib', 'urllib.request', 'http', 'http.client'):
    sys.modules[_name] = _Blocked()
`)
port.postMessage({ ready: true })

port.on('message', (message) => {
  let out = ''
  pyodide.setStdout({ batched: (line) => { out += `${line}\n` } })
  try {
    const value = pyodide.runPython(String(message.code ?? ''))
    const printed = out.trim()
    const result = value === undefined || value === null || String(value) === 'None' ? printed : String(value)
    port.postMessage({ ok: true, result })
  } catch (error) {
    const text = String(error && error.message ? error.message : error)
    const timed = /interrupt|KeyboardInterrupt/i.test(text)
    port.postMessage({ ok: false, error: text.includes('network disabled') ? 'network disabled' : timed ? 'timed out' : text })
  }
})
