"use client";

import type { MLCEngine } from "@mlc-ai/web-llm";
import { BROWSER_PROMPT_CHARS, fitBrowserPrompt, isModelNoise } from "./groundedContext";

let enginePromise: Promise<MLCEngine> | null = null;

export const BROWSER_MODEL = "Llama-3.2-1B-Instruct-q4f16_1-MLC";

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

export async function streamBrowserChat(
  messages: { role: string; content: string }[],
  onDelta: (t: string) => void,
  onProgress: (s: string) => void,
): Promise<void> {
  if (!webGpuOk()) {
    throw new Error("WebGPU is not available in this browser. Use Chrome or Edge.");
  }
  if (!enginePromise) {
    enginePromise = (async () => {
      const { CreateMLCEngine } = await import("@mlc-ai/web-llm");
      return CreateMLCEngine(BROWSER_MODEL, {
        initProgressCallback: (p: { text: string }) => onProgress(p.text),
      });
    })().catch((err) => {
      enginePromise = null;
      const m = err instanceof Error ? err.message : String(err);
      if (/failed to fetch|network|load failed|offline/i.test(m)) {
        throw new Error(
          "The in-browser model is not cached on this device yet. Leave this chat open once while online so it can download, or start Ollama on this computer.",
        );
      }
      throw err;
    });
  }
  const engine = await enginePromise;
  onProgress("");
  const system = messages.find((m) => m.role === "system")?.content || "";
  const question = [...messages].reverse().find((m) => m.role === "user")?.content || "";
  const turns = messages.filter((m) => m.role !== "system" && !(m.role === "user" && m.content === question));
  let packed = fitBrowserPrompt(system, turns, question, BROWSER_PROMPT_CHARS);
  try {
    await completeOnce(engine, packed, onDelta);
  } catch (err) {
    if (!overflow(err)) throw err;
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
