import { useState } from 'react'
import { SurfCrew, ThemeSwitch, type ThemeChoice } from '@surf/ui'

export function SignInScreen({
  theme,
  onTheme,
  onStart,
  onVerify,
  onClose,
}: {
  theme: ThemeChoice
  onTheme: (theme: ThemeChoice) => void
  onStart: (email: string) => Promise<void>
  onVerify: (email: string, code: string) => Promise<void>
  onClose: () => void
}) {
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [step, setStep] = useState<'email' | 'code'>('email')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function sendCode() {
    setBusy(true)
    setError(null)
    try {
      await onStart(email.trim())
      setStep('code')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function confirm() {
    setBusy(true)
    setError(null)
    try {
      await onVerify(email.trim(), code.trim())
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="flex h-full flex-col items-center justify-center px-6" data-screen="signin">
      <div className="flex w-full max-w-md flex-col items-center">
        <SurfCrew mood={step === 'code' ? 'thinking' : 'idle'} size={220} />
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">Sign in</h1>
        <p className="mt-2 text-center text-sm leading-relaxed text-[var(--muted)]">
          Chat and your documents stay on this computer without an account. Sign in to search the web and sync knowledge packs.
        </p>
        <form
          className="card mt-5 flex w-full flex-col gap-3 px-4 py-4"
          onSubmit={(e) => {
            e.preventDefault()
            if (step === 'email') void sendCode()
            else void confirm()
          }}
        >
          {step === 'email' ? (
            <label className="text-sm">
              <span className="font-semibold">Email</span>
              <input
                className="field mt-2"
                type="email"
                autoComplete="email"
                required
                value={email}
                aria-label="Email"
                data-signin="email"
                onChange={(e) => setEmail(e.target.value)}
              />
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
                data-signin="code"
                onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              />
            </label>
          )}
          {error && <p className="text-sm text-[var(--muted)]">{error}</p>}
          <button className="btn btn-primary" type="submit" disabled={busy} data-signin="submit">
            {busy ? 'Please wait' : step === 'email' ? 'Send code' : 'Continue'}
          </button>
          {step === 'code' && (
            <button className="btn btn-ghost" type="button" onClick={() => { setStep('email'); setCode(''); setError(null) }}>
              Use a different email
            </button>
          )}
        </form>
        <div className="mt-4">
          <ThemeSwitch value={theme} onChange={onTheme} />
        </div>
        <button className="btn btn-ghost mt-3" type="button" onClick={onClose}>Continue without an account</button>
      </div>
    </main>
  )
}
