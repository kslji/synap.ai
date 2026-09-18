/** True when the browser thinks the internet is up. Localhost can still work when this is false. */
export function networkOnline(): boolean {
  return typeof navigator === "undefined" || navigator.onLine !== false;
}

export function waitForOnline(): Promise<void> {
  if (networkOnline()) return Promise.resolve();
  return new Promise((resolve) => {
    window.addEventListener("online", () => resolve(), { once: true });
  });
}

export function isAbortError(err: unknown): boolean {
  if (typeof DOMException !== "undefined" && err instanceof DOMException && err.name === "AbortError") {
    return true;
  }
  const m = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return m.includes("aborterror") || m.includes("the operation was aborted") || m === "stopped";
}

export function looksLikeNetworkFailure(err: unknown): boolean {
  if (isAbortError(err)) return false;
  const m = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return (
    m.includes("failed to fetch") ||
    m.includes("networkerror") ||
    m.includes("network error") ||
    m.includes("host unreachable") ||
    m.includes("internet is off") ||
    m.includes("load failed") ||
    m.includes("err_internet_offline") ||
    m.includes("err_network_changed") ||
    m.includes("loading chunk") ||
    m.includes("chunkloaderror")
  );
}
