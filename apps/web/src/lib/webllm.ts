"use client";

import { BROWSER_PROMPT_CHARS, fitBrowserPrompt, isModelNoise } from "./groundedContext";
import { allowInBrowserLlm, isBrowserModelProgress, webGpuOk } from "./browserCaps";
import { networkOnline } from "./net";

export { allowInBrowserLlm, isBrowserModelProgress, webGpuOk } from "./browserCaps";
type MLCEngine = {
  resetChat: () => Promise<void>;
  chat: {
    completions: {
      create: (opts: {
        messages: { role: "system" | "user" | "assistant"; content: string }[];
        stream: true;
        max_tokens: number;
      }) => Promise<AsyncIterable<{ choices: Array<{ delta?: { content?: string } }> }>>;
    };
  };
};

let enginePromise: Promise<MLCEngine> | null = null;
let engineReady = false;

export const BROWSER_MODEL = "Llama-3.2-1B-Instruct-q4f16_1-MLC";
const LOCAL_WASM = "/mlc/Llama-3.2-1B-Instruct-q4f16_1_cs1k-webgpu.wasm";

export function hasReadyBrowserEngine(): boolean {
  return engineReady;
}

function overflow(err: unknown): boolean {
  return isModelNoise(err instanceof Error ? err.message : String(err));
}

async function loadMlc() {
  // Dynamic import: static import of @mlc-ai/web-llm freezes the tab on first /chat paint.
  return import(
    /* webpackChunkName: "webllm-engine" */
    /* webpackPrefetch: false */
    /* webpackPreload: false */
    "@mlc-ai/web-llm"
  );
}

async function mlcAppConfig() {
  const { prebuiltAppConfig } = await loadMlc();
  const origin = typeof location !== "undefined" ? location.origin : "";
  const wasm = origin ? `${origin}${LOCAL_WASM}` : "";
  return {
    ...prebuiltAppConfig,
    model_list: prebuiltAppConfig.model_list.map((m) =>
      m.model_id === BROWSER_MODEL && wasm ? { ...m, model_lib: wasm } : m,
    ),
  };
}

async function completeOnce(
  engine: MLCEngine,
  messages: { role: string; content: string }[],
  onDelta: (t: string) => void,
  signal?: AbortSignal,
): Promise<void> {
  if (signal?.aborted) throw new DOMException("Stopped", "AbortError");
  await engine.resetChat();
  const stream = await engine.chat.completions.create({
    messages: messages as { role: "system" | "user" | "assistant"; content: string }[],
    stream: true,
    max_tokens: 640,
  });
  for await (const chunk of stream) {
    if (signal?.aborted) throw new DOMException("Stopped", "AbortError");
    const t = chunk.choices[0]?.delta?.content;
    if (t) onDelta(t);
  }
}

function engineError(err: unknown): Error {
  const m = err instanceof Error ? err.message : String(err);
  const hint = m.replace(/\s+/g, " ").trim().slice(0, 220);
  if (/loading chunk|chunkloaderror|failed to fetch dynamically imported/i.test(m)) {
    return new Error(
      "A chat script is not saved on this device yet. Stay online, reload this page once, then continue offline chat.",
    );
  }
  if (/failed to fetch|network|load failed|offline|internet|err_connection|cors/i.test(m)) {
    if (!networkOnline()) {
      return new Error(
        "The on-device model is not fully ready yet. Stay online in Chrome until the model finishes downloading (~700 MB), then continue offline chat.",
      );
    }
    return new Error(
      "Could not finish downloading the in-browser model from Hugging Face (~700 MB). Keep this tab open until progress finishes, or start Ollama on this computer." +
        (hint ? ` (${hint})` : ""),
    );
  }
  return err instanceof Error ? err : new Error(m);
}

export function ensureBrowserEngine(onProgress: (s: string) => void): Promise<MLCEngine> {
  if (!allowInBrowserLlm()) {
    return Promise.reject(
      new Error(
        "In-browser model is disabled on this site so the tab stays responsive. Start Ollama or use Download zip.",
      ),
    );
  }
  if (!webGpuOk()) {
    return Promise.reject(new Error("WebGPU is not available in this browser. Open this in Google Chrome only."));
  }
  if (!enginePromise) {
    enginePromise = (async () => {
      onProgress("Loading the in-browser model…");
      // Yield so the chat UI can paint before the heavy WASM/GPU work starts.
      await new Promise<void>((r) => setTimeout(r, 50));
      const { CreateMLCEngine } = await loadMlc();
      const appConfig = await mlcAppConfig();
      const engine = await CreateMLCEngine(BROWSER_MODEL, {
        appConfig,
        initProgressCallback: (p: { text: string }) => {
          const t = p.text || "";
          if (isBrowserModelProgress(t)) onProgress("Downloading the in-browser model (first visit only)…");
          else onProgress(t);
        },
      });
      engineReady = true;
      return engine as unknown as MLCEngine;
    })().catch((err) => {
      enginePromise = null;
      engineReady = false;
      throw engineError(err);
    });
  }
  return enginePromise;
}

/** Warm WebLLM from Cache Storage — online downloads; offline loads prior Chrome cache. */
export function warmBrowserEngine(onProgress: (s: string) => void): void {
  if (!allowInBrowserLlm() || !webGpuOk()) return;
  void ensureBrowserEngine((s) => {
    if (!s) onProgress("");
    else if (!networkOnline()) onProgress("Starting on-device model…");
    else if (!isBrowserModelProgress(s)) onProgress(s);
  })
    .then(() => onProgress(""))
    .catch(() => undefined);
}

export async function streamBrowserChat(
  messages: { role: string; content: string }[],
  onDelta: (t: string) => void,
  onProgress: (s: string) => void,
  signal?: AbortSignal,
): Promise<void> {
  if (signal?.aborted) throw new DOMException("Stopped", "AbortError");
  if (!networkOnline()) {
    onProgress(engineReady ? "" : "Starting on-device model…");
  }
  const engine = await ensureBrowserEngine(onProgress);
  onProgress("");
  const system = messages.find((m) => m.role === "system")?.content || "";
  const question = [...messages].reverse().find((m) => m.role === "user")?.content || "";
  const turns = messages.filter((m) => m.role !== "system" && !(m.role === "user" && m.content === question));
  let packed = fitBrowserPrompt(system, turns, question, BROWSER_PROMPT_CHARS);
  try {
    await completeOnce(engine, packed, onDelta, signal);
  } catch (err) {
    if (signal?.aborted) throw new DOMException("Stopped", "AbortError");
    if (!overflow(err)) throw engineError(err);
    packed = fitBrowserPrompt(system, [], question, 2200);
    await completeOnce(engine, packed, onDelta, signal);
  }
}

export async function completeBrowserChat(
  messages: { role: string; content: string }[],
  onProgress: (s: string) => void,
): Promise<string> {
  let out = "";
  await streamBrowserChat(messages, (t) => {
    out += t;
  }, onProgress);
  return out.trim();
}
