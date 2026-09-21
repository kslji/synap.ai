/** Tiny browser caps — keep these out of webllm.ts so /chat does not load @mlc-ai/web-llm. */

export function webGpuOk(): boolean {
  return typeof navigator !== "undefined" && "gpu" in navigator;
}

/** True for raw WebLLM/MLC download lines — never show these in the chat composer. */
export function isBrowserModelProgress(s: string): boolean {
  return /Fetching param cache|Loading model from cache|cache\[\d|It can take a while when we first visit|webgpu\.wasm|Start to fetch|Finish loading on WebGPU|Loading the in-browser model/i.test(
    s,
  );
}
