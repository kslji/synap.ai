/** Centered shell shown while client-only pages hydrate. */
export function PageLoading({ label = "Loading pack…" }: { label?: string }) {
  return (
    <div className="landing page-loading">
      <div className="landing-atmosphere" aria-hidden />
      <div className="page-loading-inner" role="status" aria-live="polite">
        <span className="page-loading-pulse" aria-hidden />
        <p>{label}</p>
      </div>
    </div>
  );
}
