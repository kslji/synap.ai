export function BetaUnsignedNote() {
  return (
    <aside className="mt-6 border-t border-[var(--line)] pt-6" data-beta-unsigned="yes">
      <p className="pill">Beta: opening on Mac</p>
      <p className="mt-3 max-w-3xl text-sm leading-relaxed">
        Mac users: during the beta, Synap.surf isn&apos;t signed by Apple yet, so macOS may say it can&apos;t be opened or is from an unidentified developer. You only need to do this once.
      </p>
      <ol className="mt-3 max-w-3xl list-decimal space-y-1 pl-5 text-sm leading-relaxed">
        <li>Open Synap.surf once so macOS blocks it.</li>
        <li>Go to System Settings → Privacy &amp; Security.</li>
        <li>Scroll to the Security section.</li>
        <li>Click Open Anyway next to Synap.surf, then confirm.</li>
      </ol>
      <p className="mt-3 max-w-3xl text-sm leading-relaxed text-[var(--muted)]">
        Windows users: if you see &quot;Windows protected your PC&quot;, click the small underlined More info link under the warning. The window then shows the app name and Unknown publisher, with a Run anyway button at the bottom right. Click Run anyway to install. You only need to do this once.
      </p>
    </aside>
  )
}
