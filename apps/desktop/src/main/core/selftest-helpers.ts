/**
 * Shared helpers for the self-test and eval harnesses: locate the repo and
 * sign in through the dev OTP flow (console mail exposes the code in lite mode).
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'

export function repoRoot(): string {
  let dir = process.cwd()
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(dir, 'services', 'api', 'app', 'main.py'))) return dir
    const parent = join(dir, '..')
    if (parent === dir) break
    dir = parent
  }
  throw new Error('services/api not found from ' + process.cwd())
}

export async function loginDev(base: string, email: string, deviceUid = 'selftest'): Promise<string> {
  const start = await fetch(`${base}/v1/auth/otp/start`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email }),
  })
  const started = await start.json() as { dev_code?: string; error?: { message?: string } }
  if (!start.ok || !started.dev_code) throw new Error(started.error?.message || `dev OTP missing (${start.status})`)
  const verify = await fetch(`${base}/v1/auth/otp/verify`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      email,
      code: started.dev_code,
      device: { device_uid: deviceUid, name: 'Selftest', os: 'linux', arch: 'x64', app_version: '0.1.0' },
    }),
  })
  const body = await verify.json() as { access_token?: string; error?: { message?: string } }
  if (!verify.ok || !body.access_token) throw new Error(body.error?.message || `OTP verify failed (${verify.status})`)
  return body.access_token
}
