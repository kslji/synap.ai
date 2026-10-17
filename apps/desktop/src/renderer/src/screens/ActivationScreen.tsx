import { useState } from 'react'
import { StarSurf, ThemeSwitch, type ThemeChoice } from '@surf/ui'
import type { LicenceStatus } from '../../../shared/ipc-contract'

export function ActivationScreen({
  theme,
  onTheme,
  status,
  offlineOnly,
  onAllowNetwork,
  onStart,
  onVerify,
  onKey,
  renewal,
}: {
  theme: ThemeChoice
  onTheme: (theme: ThemeChoice) => void
  status: LicenceStatus
  offlineOnly: boolean
  onAllowNetwork: () => Promise<void>
  onStart: (email: string) => Promise<void>
  onVerify: (email: string, code: string) => Promise<void>
  onKey: (key: string) => Promise<void>
  renewal?: boolean
}) {
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [key, setKey] = useState('')
  const [step, setStep] = useState<'email' | 'code'>('email')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function run(fn: () => Promise<void>) {
    setBusy(true)
    setError(null)
    try {
      await fn()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="flex h-full flex-col items-center justify-center overflow-auto px-6 py-8" data-screen={renewal ? 'renew' : 'activate'} data-licence-state={status.state}>
      <div className="flex w-full max-w-md flex-col items-center">
        <StarSurf state="guiding" size={180} />
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">{renewal ? 'Renew Synap.surf' : 'Activate Synap.surf'}</h1>
        <p className="mt-2 text-center text-sm leading-relaxed text-[var(--muted)]">
          {renewal
            ? 'This subscription has ended. The app stays locked, including when this computer is offline. There is no extra time after the end date. Setting the clock back does not extend it.'
            : 'The installer is free to copy. This computer needs a licence before the app will open. Sign in with the account that bought it, or enter a licence key.'}
        </p>
        {renewal && status.subscriptionEndsAt && (
          <p className="mt-3 text-center text-sm font-semibold" data-subscription-ended={status.subscriptionEndsAt.slice(0, 10)}>
            Ended {status.subscriptionEndsAt.slice(0, 10)}
          </p>
        )}
        {status.message && <p className="mt-3 text-center text-sm leading-relaxed">{status.message}</p>}
        <p className="mt-2 text-center text-xs leading-relaxed text-[var(--muted)]">
          The app checks the licence file on this computer. That stops a copied installer from running by itself. It is not a guarantee against a modified app.
        </p>
        {offlineOnly && (
          <button className="btn btn-ghost mt-3" type="button" onClick={() => { void run(onAllowNetwork) }}>
            Allow a connection to activate
          </button>
        )}
        <form
          className="card mt-5 flex w-full flex-col gap-3 px-4 py-4"
          onSubmit={(e) => {
            e.preventDefault()
            if (step === 'email') void run(async () => { await onStart(email.trim()); setStep('code') })
            else void run(() => onVerify(email.trim(), code.trim()))
          }}
        >
          <div className="text-sm font-semibold">Sign in</div>
          {step === 'email' ? (
            <label className="text-sm">
              <span className="font-semibold">Email</span>
              <input className="field mt-2" type="email" autoComplete="email" required value={email} aria-label="Email" data-activate="email" onChange={(e) => setEmail(e.target.value)} />
            </label>
          ) : (
            <label className="text-sm">
              <span className="font-semibold">Code for {email}</span>
              <input
                className="field mt-2 tracking-[0.3em]"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="\d{6}"
                maxLength={6}
                required
                value={code}
                aria-label="Sign-in code"
                data-activate="code"
                onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              />
            </label>
          )}
          <button className="btn btn-primary" type="submit" disabled={busy} data-activate="signin">
            {busy ? 'Please wait' : step === 'email' ? 'Send code' : 'Activate this computer'}
          </button>
        </form>
        <form
          className="card mt-3 flex w-full flex-col gap-3 px-4 py-4"
          onSubmit={(e) => {
            e.preventDefault()
            void run(() => onKey(key.trim()))
          }}
        >
          <label className="text-sm">
            <span className="font-semibold">Licence key</span>
            <input className="field mt-2" value={key} autoComplete="off" spellCheck={false} required aria-label="Licence key" data-activate="key" onChange={(e) => setKey(e.target.value)} />
          </label>
          <button className="btn btn-primary" type="submit" disabled={busy} data-activate="key-submit">Use this key</button>
        </form>
        {error && <p className="mt-3 text-center text-sm">{error}</p>}
        <div className="mt-4">
          <ThemeSwitch value={theme} onChange={onTheme} />
        </div>
      </div>
    </main>
  )
}
