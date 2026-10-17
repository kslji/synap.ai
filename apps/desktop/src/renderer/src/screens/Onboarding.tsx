import { useState } from 'react'
import { StarSurf, ThemeSwitch, type ThemeChoice } from '@surf/ui'
import type { ModelStatus } from '../../../shared/ipc-contract'
import { MODEL_MISSING_COPY, modelSiteUrl } from '../model-site'

type Step = 'welcome' | 'privacy' | 'setup'

export function Onboarding({
  status,
  theme,
  onTheme,
  onReady,
}: {
  status: ModelStatus
  theme: ThemeChoice
  onTheme: (theme: ThemeChoice) => void
  onReady: () => void
}) {
  const ready = status.models.some((model) => model.role === 'chat' && model.installed)
  const [step, setStep] = useState<Step>('welcome')

  return (
    <main className="relative flex h-full items-center justify-center bg-[var(--bg)] px-6" data-screen="onboarding" data-first-launch="yes" data-onboarding-step={step}>
      <div className="absolute right-4 top-4">
        <ThemeSwitch value={theme} onChange={onTheme} />
      </div>
      <div className="card w-full max-w-xl px-8 py-8">
        <StarSurf state={ready ? 'success' : 'guiding'} size={180} />
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
            <p className="mt-2 text-xs font-semibold uppercase tracking-[0.16em] text-[var(--muted)]">Your model</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight">{ready ? 'Ready' : 'One more step'}</h1>
            {ready ? (
              <p className="mt-3 text-[15px] leading-relaxed text-[var(--muted)]">A model is already on this computer.</p>
            ) : (
              <p className="mt-3 text-[15px] leading-relaxed text-[var(--muted)]" data-model-missing="yes">{MODEL_MISSING_COPY}</p>
            )}
            {!ready && (
              <button className="btn btn-ghost mt-4" type="button" data-open-site="yes" onClick={() => { void window.surf.links.open(modelSiteUrl()) }}>
                Open synap.surf
              </button>
            )}
            <div className="mt-6 flex flex-wrap gap-2">
              <button className="btn btn-ghost" type="button" onClick={() => setStep('privacy')}>Back</button>
              <button className="btn btn-primary" type="button" data-first-launch-go="yes" onClick={onReady}>Continue</button>
            </div>
          </>
        )}
      </div>
    </main>
  )
}
