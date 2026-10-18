/**
 * GitHub OAuth flow — Device Flow (no server needed).
 *
 * This uses GitHub's Device Authorization Grant so that no redirect URI
 * or backend server is required. The token stays in-memory only.
 *
 * Docs: https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps#device-flow
 */

export interface DeviceFlowState {
  deviceCode: string
  userCode: string
  verificationUri: string
  expiresIn: number
  interval: number
}

export interface TokenResult {
  accessToken: string
  tokenType: string
  scope: string
}

const CLIENT_ID = import.meta.env.VITE_GITHUB_CLIENT_ID ?? ''

/** Step 1 — Request a device code */
export async function requestDeviceCode(): Promise<DeviceFlowState> {
  const res = await fetch('https://github.com/login/device/code', {
    method: 'POST',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      client_id: CLIENT_ID,
      scope: 'repo,read:user',
    }),
  })
  if (!res.ok) throw new Error(`GitHub device code error: ${res.status}`)
  const data = await res.json() as {
    device_code: string
    user_code: string
    verification_uri: string
    expires_in: number
    interval: number
  }
  return {
    deviceCode: data.device_code,
    userCode: data.user_code,
    verificationUri: data.verification_uri,
    expiresIn: data.expires_in,
    interval: data.interval,
  }
}

/** Step 2 — Poll until token or error */
export async function pollForToken(
  deviceCode: string,
  intervalSecs: number,
  signal: AbortSignal,
): Promise<TokenResult> {
  const wait = (ms: number) =>
    new Promise<void>((res, rej) => {
      const t = setTimeout(res, ms)
      signal.addEventListener('abort', () => { clearTimeout(t); rej(new DOMException('Aborted', 'AbortError')) })
    })

  while (true) {
    await wait(intervalSecs * 1000)
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError')

    const res = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: CLIENT_ID,
        device_code: deviceCode,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      }),
    })
    const data = await res.json() as {
      access_token?: string
      token_type?: string
      scope?: string
      error?: string
      interval?: number
    }

    if (data.access_token) {
      return {
        accessToken: data.access_token,
        tokenType: data.token_type ?? 'bearer',
        scope: data.scope ?? '',
      }
    }
    if (data.error === 'slow_down') {
      intervalSecs = (data.interval ?? intervalSecs) + 5
      continue
    }
    if (data.error === 'authorization_pending') continue
    throw new Error(data.error ?? 'Unknown OAuth error')
  }
}
