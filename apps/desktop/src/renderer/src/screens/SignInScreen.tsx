import { useState } from 'react'
import { Moon, Sun } from 'lucide-react'

export function SignInScreen({
  theme,
  onTheme,
  onStart,
  onVerify,
  onClose,
}: {
  theme: 'dark' | 'light'
  onTheme: (theme: 'dark' | 'light') => void
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
    <main className="flex h-full flex-col items-center justify-center bg-[#F2F2F7] px-6 text-[#17171C]" data-screen="signin">
      <div className="flex w-full max-w-md flex-col items-center">
        <div className="flex items-center gap-2.5">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#F97316] text-lg font-bold text-white">S</div>
          <span className="text-xl font-bold tracking-tight">Surf<span className="text-[#F97316]">.</span></span>
        </div>
        <h1 className="mt-6 text-2xl font-bold tracking-tight">Sign in</h1>
        <p className="mt-2 text-center text-sm leading-relaxed text-[#5B5B6B]">
          Chat and your documents stay on this computer without an account. Sign in to search the web and sync knowledge packs.
        </p>
        <form
          className="mt-5 flex w-full flex-col gap-3 rounded-2xl bg-white px-5 py-5 shadow-[0_1px_6px_rgba(23,23,28,0.06)]"
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
                className="mt-2 w-full rounded-xl border border-[#E4E4EE] bg-[#FAFAFC] px-3.5 py-2.5 text-sm outline-none transition-colors focus:border-[#F97316] focus:bg-white"
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
                className="mt-2 w-full rounded-xl border border-[#E4E4EE] bg-[#FAFAFC] px-3.5 py-2.5 text-sm tracking-[0.3em] outline-none transition-colors focus:border-[#F97316] focus:bg-white"
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
          {error && <p className="text-sm text-[#B91C1C]">{error}</p>}
          <button
            className="mt-1 w-full rounded-xl bg-[#F97316] py-3 text-sm font-semibold text-white transition-colors hover:bg-[#EA580C] disabled:opacity-60"
            type="submit"
            disabled={busy}
            data-signin="submit"
          >
            {busy ? 'Please wait' : step === 'email' ? 'Send code' : 'Continue'}
          </button>
          {step === 'code' && (
            <button
              className="text-sm font-medium text-[#5B5B6B] hover:text-[#17171C]"
              type="button"
              onClick={() => { setStep('email'); setCode(''); setError(null) }}
            >
              Use a different email
            </button>
          )}
        </form>
        <div className="mt-5 flex items-center gap-1 rounded-full bg-white p-1 shadow-[0_1px_4px_rgba(23,23,28,0.06)]">
          <button
            type="button"
            onClick={() => onTheme('light')}
            className={`flex items-center gap-1.5 rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
              theme === 'light' ? 'bg-[#F97316] text-white' : 'text-[#5B5B6B] hover:bg-[#F1F1F6]'
            }`}
          >
            <Sun size={14} /> Light
          </button>
          <button
            type="button"
            onClick={() => onTheme('dark')}
            className={`flex items-center gap-1.5 rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
              theme === 'dark' ? 'bg-[#F97316] text-white' : 'text-[#5B5B6B] hover:bg-[#F1F1F6]'
            }`}
          >
            <Moon size={14} /> Dark
          </button>
        </div>
        <button
          className="mt-4 rounded-xl bg-white px-5 py-2.5 text-sm font-semibold shadow-[0_1px_4px_rgba(23,23,28,0.06)] transition-colors hover:bg-[#FAFAFC]"
          type="button"
          onClick={onClose}
        >
          Continue without an account
        </button>
      </div>
    </main>
  )
}
