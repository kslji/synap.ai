import { useEffect, useState } from 'react'
import { Markdown } from '@surf/ui'
import guide from '../../../../../../agents/code/blog/qwen35-vs-gemma4.md?raw'

export function ModelGuideDialog({ markdown, onClose }: { markdown: string; onClose: () => void }) {
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="fixed inset-0 z-30 flex justify-center overflow-auto bg-black/40 px-4 py-8" role="dialog" aria-modal="true" aria-label="Which model should I pick?" data-model-guide="open">
      <div className="card h-fit w-full max-w-3xl px-6 py-6">
        <div className="flex justify-end">
          <button className="btn btn-ghost" type="button" onClick={onClose}>Close</button>
        </div>
        <div className="mt-2 text-[15px] leading-relaxed text-[var(--ink)]">
          <Markdown source={markdown} />
        </div>
      </div>
    </div>
  )
}

export function ModelGuideButton() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button className="text-xs font-semibold text-[var(--accent-text)]" type="button" data-model-guide="button" onClick={() => setOpen(true)}>
        Which model should I pick?
      </button>
      {open && <ModelGuideDialog markdown={guide} onClose={() => setOpen(false)} />}
    </>
  )
}
