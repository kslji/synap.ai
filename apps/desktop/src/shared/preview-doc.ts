/**
 * Sandboxed preview document. No network, no remote scripts, no inline event handlers.
 * The iframe must use sandbox="allow-scripts" and must not add allow-same-origin.
 */
export interface PreviewDoc {
  srcdoc: string
  sandbox: 'allow-scripts'
}

export function previewDocument(source: string): PreviewDoc {
  const body = source
    .replace(/<script[^>]+src\s*=\s*["']https?:[^"']+["'][^>]*>\s*<\/script>/gi, '')
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
  const srcdoc = `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:; connect-src 'none'; form-action 'none'"></head><body>${body}</body></html>`
  return { srcdoc, sandbox: 'allow-scripts' }
}
