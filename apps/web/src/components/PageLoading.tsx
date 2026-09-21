import { BrandMark } from "./BrandMark";

/** Centered shell while client-only pages hydrate — animation only, no copy. */
export function PageLoading() {
  return (
    <div className="landing page-loading">
      <div className="landing-atmosphere" aria-hidden />
      <div className="page-loading-inner" role="status" aria-live="polite" aria-label="Loading">
        <div className="page-loading-mark">
          <span className="page-loading-ring" aria-hidden />
          <BrandMark size={40} />
        </div>
      </div>
    </div>
  );
}
