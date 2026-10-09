import { useState } from 'react'
import { SurfDots } from '@surf/ui'
import type { ModelStatus } from '../../../shared/ipc-contract'
import { formatBytes, tierLabel } from '../format'

export function Onboarding({
  status,
  progress,
  error,
  onDownload,
  onReady,
}: {
  status: ModelStatus
  progress: number
  error: string | null
  onDownload: (chatId: string) => Promise<void>
  onReady: (chatId: string) => void
}) {
  const chats = status.models.filter((m) => m.role === 'chat' && m.fitsRam)
  const suggested = status.models.find((m) => m.recommended)?.id ?? chats[0]?.id ?? ''
  const [step, setStep] = useState(0)
  const [pick, setPick] = useState(suggested)
  const [working, setWorking] = useState(false)
  const chosen = status.models.find((m) => m.id === pick)
  const embed = status.models.find((m) => m.role === 'embedding')
  const ready = Boolean(chosen?.installed && embed?.installed)

  async function download() {
    setWorking(true)
    try { await onDownload(pick) } finally { setWorking(false) }
  }

  return (
    <main className="flex h-full items-center justify-center bg-[var(--bg)] px-6" data-screen="onboarding">
      <div className="card w-full max-w-xl px-8 py-8">
        <SurfDots mood={step === 3 ? 'answering' : working ? 'thinking' : 'idle'} size={120} />
        <p className="mt-2 text-xs font-semibold uppercase tracking-[0.16em] text-[var(--muted)]">Step {step + 1} of 4</p>
        {step === 0 && (
          <>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight">This computer</h1>
            <p className="mt-2 text-[15px] leading-relaxed text-[var(--muted)]">
              Surf looks at memory once, then downloads a model that fits. After that, chat works without the internet.
            </p>
            <dl className="mt-5 grid grid-cols-2 gap-3 text-sm">
              <Stat k="Memory" v={`${status.ramGb} GB`} />
              <Stat k="Fit" v={tierLabel(status.tier)} />
              <Stat k="Processor" v={status.cpuModel} />
              <Stat k="Cores" v={String(status.cores)} />
            </dl>
            <button className="btn btn-primary mt-6" type="button" onClick={() => setStep(1)}>Choose a model</button>
          </>
        )}
        {step === 1 && (
          <>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight">Pick a chat model</h1>
            <p className="mt-2 text-sm text-[var(--muted)]">EmbeddingGemma 2 downloads with it. Thinking mode stays off.</p>
            <div className="mt-4 flex flex-col gap-2">
              {chats.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setPick(m.id)}
                  className={`rounded-2xl border px-4 py-3 text-left ${pick === m.id ? 'border-[var(--accent)] bg-[var(--accent-soft)]' : 'border-[var(--line)]'}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold">{m.label}</span>
                    {m.recommended && <span className="pill">Suggested</span>}
                  </div>
                  <div className="mt-1 text-sm text-[var(--muted)]">{formatBytes(m.sizeBytes)} · {m.fitsRam ? 'Fits this computer' : 'Tight'}</div>
                </button>
              ))}
            </div>
            <div className="mt-5 flex gap-2">
              <button className="btn btn-ghost" type="button" onClick={() => setStep(0)}>Back</button>
              <button className="btn btn-primary" type="button" disabled={!pick} onClick={() => setStep(ready ? 3 : 2)}>Continue</button>
            </div>
          </>
        )}
        {step === 2 && (
          <>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight">Download</h1>
            <p className="mt-2 text-sm text-[var(--muted)]">
              {chosen?.label} and EmbeddingGemma 2. You can pause by quitting; the next try resumes.
            </p>
            <div className="progress mt-5"><b style={{ width: `${Math.round(progress * 100)}%` }} /></div>
            <p className="mt-2 text-xs text-[var(--muted)]">{Math.round(progress * 100)}%</p>
            {error && <p className="mt-2 text-sm text-[var(--danger)]">{error}</p>}
            <div className="mt-5 flex gap-2">
              <button className="btn btn-ghost" type="button" onClick={() => setStep(1)} disabled={working}>Back</button>
              <button className="btn btn-primary" type="button" onClick={() => void download()} disabled={working || status.offlineOnly}>
                {status.offlineOnly ? 'Turn off Offline only' : working ? 'Downloading' : 'Download'}
              </button>
              {ready && <button className="btn btn-ghost" type="button" onClick={() => setStep(3)}>Already installed</button>}
            </div>
          </>
        )}
        {step === 3 && (
          <>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight">You&apos;re ready</h1>
            <p className="mt-2 text-[15px] leading-relaxed text-[var(--muted)]">
              The model is on this computer. Chats stay here too.
            </p>
            <button className="btn btn-primary mt-6" type="button" onClick={() => onReady(pick)}>Start chatting</button>
          </>
        )}
      </div>
    </main>
  )
}

function Stat({ k, v }: { k: string; v: string }) {
  return (
    <div className="rounded-2xl bg-[var(--bg)] px-3 py-3">
      <dt className="text-xs text-[var(--muted)]">{k}</dt>
      <dd className="mt-1 truncate text-sm font-semibold">{v}</dd>
    </div>
  )
}
