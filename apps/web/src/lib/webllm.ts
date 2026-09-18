"use client";

import { CreateMLCEngine, type MLCEngine } from "@mlc-ai/web-llm";
import { BROWSER_PROMPT_CHARS, fitBrowserPrompt, isModelNoise } from "./groundedContext";
import { networkOnline } from "./net";

let enginePromise: Promise<MLCEngine> | null = null;
let engineReady = false;

export const BROWSER_MODEL = "Llama-3.2-1B-Instruct-q4f16_1-MLC";

export function hasReadyBrowserEngine(): boolean {
  return engineReady;
}

export function webGpuOk(): boolean {
  return typeof navigator !== "undefined" && "gpu" in navigator;
}

function overflow(err: unknown): boolean {
  return isModelNoise(err instanceof Error ? err.message : String(err));
}

async function completeOnce(
  engine: MLCEngine,
  messages: { role: string; content: string }[],
  onDelta: (t: string) => void,
): Promise<void> {
  await engine.resetChat();
  const stream = await engine.chat.completions.create({
    messages: messages as { role: "system" | "user" | "assistant"; content: string }[],
    stream: true,
    max_tokens: 280,
  });
  for await (const chunk of stream) {
    const t = chunk.choices[0]?.delta?.content;
    if (t) onDelta(t);
  }
}

function engineError(err: unknown): Error {
  const m = err instanceof Error ? err.message : String(err);
  if (/loading chunk|chunkloaderror|failed to fetch dynamically imported/i.test(m)) {
    return new Error(
      "A chat script is not saved on this device yet. Stay online, reload this page once, then you can use it with Wi-Fi off.",
    );
  }
  if (/failed to fetch|network|load failed|offline|internet/i.test(m)) {
    if (!networkOnline()) {
      return new Error(
        "The in-browser model is only partly saved on this device (your sidebar shows the size — it needs about 700 MB). Turn Wi-Fi on, keep this chat open until that number stops growing, then you can chat offline. Attached files still work offline as excerpts. Or start Ollama on this computer.",
      );
    }
    return new Error(
      "Could not download the in-browser model. Stay on this page while online until the progress line finishes (the files come from Hugging Face), then send again. Or start Ollama on this computer.",
    );
  }
  return err instanceof Error ? err : new Error(m);
}

export function ensureBrowserEngine(onProgress: (s: string) => void): Promise<MLCEngine> {
  if (!webGpuOk()) {
    return Promise.reject(new Error("WebGPU is not available in this browser. Use Chrome or Edge."));
  }
  if (!enginePromise) {
    enginePromise = CreateMLCEngine(BROWSER_MODEL, {
      initProgressCallback: (p: { text: string }) => onProgress(p.text),
    })
      .then((engine) => {
        engineReady = true;
        return engine;
      })
      .catch((err) => {
        enginePromise = null;
        engineReady = false;
        throw engineError(err);
      });
  }
  return enginePromise;
}

/** Start the Hugging Face model download while the tab is online (do not wait for the first send). */
export function warmBrowserEngine(onProgress: (s: string) => void): void {
  if (!webGpuOk() || !networkOnline()) return;
  void ensureBrowserEngine(onProgress).then(() => onProgress("")).catch(() => undefined);
}

export async function streamBrowserChat(
  messages: { role: string; content: string }[],
  onDelta: (t: string) => void,
  onProgress: (s: string) => void,
): Promise<void> {
  if (!networkOnline() && !engineReady) {
    throw engineError(new Error("offline"));
  }
  const engine = await ensureBrowserEngine(onProgress);
  onProgress("");
  const system = messages.find((m) => m.role === "system")?.content || "";
  const question = [...messages].reverse().find((m) => m.role === "user")?.content || "";
  const turns = messages.filter((m) => m.role !== "system" && !(m.role === "user" && m.content === question));
  let packed = fitBrowserPrompt(system, turns, question, BROWSER_PROMPT_CHARS);
  try {
    await completeOnce(engine, packed, onDelta);
  } catch (err) {
    if (!overflow(err)) throw engineError(err);
    packed = fitBrowserPrompt(system, [], question, 2200);
    await completeOnce(engine, packed, onDelta);
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
