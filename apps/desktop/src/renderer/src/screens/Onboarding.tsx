import { useEffect, useRef, useState } from 'react'
import { StarSurf, ThemeSwitch, type ThemeChoice } from '@surf/ui'
import type { ModelStatus } from '../../../shared/ipc-contract'

type Step = 'welcome' | 'privacy' | 'setup'

export function Onboarding({
  status,
  progress,
  error,
  theme,
  onTheme,
  onDownload,
  onReady,
}: {
  status: ModelStatus
  progress: number
  error: string | null
  theme: ThemeChoice
  onTheme: (theme: ThemeChoice) => void
  onDownload: (chatId: string) => Promise<void>
  onReady: (chatId: string) => void
}) {
  const suggested = status.models.find((m) => m.recommended && m.role === 'chat')?.id
    ?? status.models.find((m) => m.role === 'chat' && m.fitsRam)?.id
    ?? ''
  const chosen = status.models.find((m) => m.id === suggested)
  const embed = status.models.find((m) => m.role === 'embedding')
  const ready = Boolean(chosen?.installed && embed?.installed)
  const [step, setStep] = useState<Step>('welcome')
  const [working, setWorking] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)
  const started = useRef(false)
  const shownError = localError ?? error

  useEffect(() => {
    if (step !== 'setup' || ready || started.current || !suggested) return
    started.current = true
    setWorking(true)
    void onDownload(suggested)
      .catch((e: unknown) => setLocalError((e as Error).message))
      .finally(() => setWorking(false))
  }, [step, ready, suggested, onDownload])

  const bar = ready ? 1 : working ? progress : 0

  return (
    <main className="relative flex h-full items-center justify-center bg-[var(--bg)] px-6" data-screen="onboarding" data-first-launch="yes" data-onboarding-step={step}>
      <div className="absolute right-4 top-4">
        <ThemeSwitch value={theme} onChange={onTheme} />
      </div>
      <div className="card w-full max-w-xl px-8 py-8">
        <StarSurf state={step === 'setup' && working ? 'searching' : shownError ? 'error' : 'guiding'} size={180} />
        {step === 'welcome' && (
          <>
            <p className="mt-2 text-xs font-semibold uppercase tracking-[0.16em] text-[var(--muted)]">Welcome</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight">Meet Star Surf</h1>
            <p className="mt-3 text-[15px] leading-relaxed text-[var(--muted)]">
              Synap.surf is your offline companion. Chats stay on this computer.
            </p>
            <button className="btn btn-primary mt-6" type="button" data-first-launch-go="yes" onClick={() => setStep('privacy')}>Continue</button>
          </>
        )}
        {step === 'privacy' && (
          <>
            <p className="mt-2 text-xs font-semibold uppercase tracking-[0.16em] text-[var(--muted)]">Before you start</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight">A short note</h1>
            <p className="mt-3 text-[15px] leading-relaxed text-[var(--muted)]">
              This beta is not signed by Apple or Microsoft. macOS or Windows may ask once before it opens. Chats sit in an encrypted database on this machine. Synap.surf does not edit, move, or delete your files on its own. Web search stays off until you allow it.
            </p>
            <div className="mt-6 flex gap-2">
              <button className="btn btn-ghost" type="button" onClick={() => setStep('welcome')}>Back</button>
              <button className="btn btn-primary" type="button" data-first-launch-go="yes" onClick={() => setStep('setup')}>Set up</button>
            </div>
          </>
        )}
        {step === 'setup' && (
          <>
            <p className="mt-2 text-xs font-semibold uppercase tracking-[0.16em] text-[var(--muted)]">Setting up your AI</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight">{chosen?.label ?? 'Qwen3.5'}</h1>
            <p className="mt-3 text-[15px] leading-relaxed text-[var(--muted)]">
              {ready
                ? 'The model that fits this computer is ready. Chat works offline after this.'
                : 'One download, picked for this computer. You can quit and it will resume.'}
            </p>
            <div className="mt-4" data-download-progress="yes">
              <div className="progress"><b style={{ width: `${Math.round(bar * 100)}%` }} /></div>
              <p className="mt-2 text-xs text-[var(--muted)]">{Math.round(bar * 100)}%</p>
            </div>
            {shownError && <p className="mt-3 text-sm text-[var(--danger)]">{shownError}</p>}
            <div className="mt-6 flex flex-wrap gap-2">
              {(ready || shownError) && (
                <button className="btn btn-primary" type="button" data-first-launch-go="yes" onClick={() => onReady(suggested)} disabled={!suggested}>
                  {ready ? 'Continue' : 'Continue without the model'}
                </button>
              )}
              {shownError && !ready && (
                <button className="btn btn-ghost" type="button" onClick={() => { started.current = false; setLocalError(null); setStep('privacy') }}>Try again</button>
              )}
            </div>
          </>
        )}
      </div>
    </main>
  )
}
