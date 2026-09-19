"use client";

import { ImagePlus, Mic, MicOff, Paperclip, Pencil, Plus, Send, Square, Trash2 } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  deleteAttachment,
  deleteThread,
  getMemory,
  listAttachments,
  listThreads,
  newThread,
  originStorage,
  packThreads,
  reassignAttachments,
  saveAttachment,
  saveMemory,
  saveThread,
  snapshotStats,
  titleFrom,
  wipeBrowserStore,
  replaceThreads,
  type ChatMsg,
  type DataSnapshot,
  type Memory,
  type OriginStorage,
  type StoredAttachment,
  type Thread,
} from "@/lib/browserStore";
import { ingestFile, unpackZipIfNeeded } from "@/lib/attachments";
import { sanitizeUserText } from "@/lib/guardrails";
import {
  BROWSER_DOC_BUDGET,
  BROWSER_MEMORY_BUDGET,
  BROWSER_TURN_BUDGET,
  OLLAMA_DOC_BUDGET,
  extractiveFileOverview,
  groundedSystem,
  isMetaAgentNoise,
  retrieveFileContext,
  thinAttachmentReply,
  trimTurns,
  fitBrowserPrompt,
  offlineFileBrief,
  wantsFileOverview,
  wantsFileConvert,
  FILE_CONVERT_UNSUPPORTED,
  wantsSavedSummary,
} from "@/lib/groundedContext";
import { canUseFilePicker, filesFromDataTransfer, pickFilesOrFolder } from "@/lib/deviceFolder";
import { downloadOnThisDevice } from "@/lib/openOnDevice";
import { fetchHostStorage, getToken, health, indexMoss, parseApiError, searchMoss, streamChat, createLocalInstance, type Health } from "@/lib/api";
import { fetchProfile, clearAccount, type UserProfile } from "@/lib/account";
import { isAbortError, looksLikeNetworkFailure, networkOnline } from "@/lib/net";
import { AuthDialog } from "./AuthDialog";
import { OfflineBanner } from "./OfflineBanner";
import { AttachmentBar } from "./AttachmentBar";
import { FeedbackInbox } from "./FeedbackInbox";
import { MessageFeedback } from "./MessageFeedback";
import { LocalDataCard, type LastChange } from "./LocalDataCard";
import { LocalEngines, type LocalEngine } from "./LocalEngines";
import { MarkdownBody } from "./MarkdownBody";
import { ThinkingBubble } from "./ThinkingBubble";
import { VoiceRoom } from "./VoiceRoom";
import { canDictate, startDictation } from "@/lib/dictation";
import { completeBrowserChat, hasReadyBrowserEngine, streamBrowserChat, warmBrowserEngine, webGpuOk } from "@/lib/webllm";
import { replyTimeLabel } from "@/lib/responseTime";
import { BrandMark } from "./BrandMark";

function stampReply(messages: ChatMsg[], extra: Pick<ChatMsg, "waitMs" | "backendMs" | "engine">): ChatMsg[] {
  return messages.map((m, i, arr) =>
    i === arr.length - 1 && m.role === "assistant" ? { ...m, ...extra } : m,
  );
}

function appendAssistant(all: ChatMsg[], piece: string): ChatMsg[] {
  if (!piece) return all;
  const last = all[all.length - 1];
  if (!last || last.role !== "assistant") return all;
  return all.map((m, i) => (i === all.length - 1 ? { ...m, content: m.content + piece } : m));
}

function setAssistant(all: ChatMsg[], content: string): ChatMsg[] {
  const last = all[all.length - 1];
  if (!last || last.role !== "assistant") return all;
  return all.map((m, i) => (i === all.length - 1 ? { ...m, content } : m));
}

function systemPrompt(memory: Memory | null, extra: string, memoryBudget = BROWSER_MEMORY_BUDGET): string {
  return groundedSystem(memory?.summary || "", extra, memoryBudget);
}

function formatMossHits(hit: { docs?: Array<{ text?: string }>; time_taken_ms?: number; backend?: string } | null): string {
  if (!hit?.docs?.length) return "";
  const lines = hit.docs.slice(0, 6).map((d, i) => `${i + 1}. ${(d.text || "").slice(0, 500)}`);
  return `\n\nMoss retrieval (${hit.time_taken_ms ?? "?"} ms, ${hit.backend || "local"}):\n${lines.join("\n")}`;
}

export function LocalChat() {
  const [threads, setThreads] = useState<Thread[]>([]);
  const [active, setActive] = useState<Thread | null>(null);
  const [memory, setMemory] = useState<Memory | null>(null);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [gpu, setGpu] = useState<boolean | null>(null);
  const [dictateOk, setDictateOk] = useState(false);
  const [listening, setListening] = useState(false);
  const [wipeArmed, setWipeArmed] = useState(false);
  const [origin, setOrigin] = useState<OriginStorage | null>(null);
  const [hostStore, setHostStore] = useState<{
    bytes: number;
    data_dir: string | null;
    sqlite?: { conversations: number; messages: number; feedback?: number };
  } | null>(null);
  const [last, setLast] = useState<LastChange | null>(null);
  const [engine, setEngine] = useState<LocalEngine>("browser");
  const [status, setStatus] = useState<Health | null>(null);
  const [lkStatus, setLkStatus] = useState("");
  const [files, setFiles] = useState<StoredAttachment[]>([]);
  const [attachOpen, setAttachOpen] = useState(false);
  const [fbTick, setFbTick] = useState(0);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [authOpen, setAuthOpen] = useState(false);
  const [netOn, setNetOn] = useState(true);
  const [authNext, setAuthNext] = useState<null | (() => void)>(null);
  const [editIdx, setEditIdx] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [turnMeta, setTurnMeta] = useState<{
    model?: string;
    sources?: Array<{ title?: string; kind?: string; snippet?: string }>;
    moss?: { time_taken_ms?: number; backend?: string; hits?: number };
  } | null>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const imageRef = useRef<HTMLInputElement>(null);
  const stopMic = useRef<(() => void) | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback(async (preferId?: string) => {
    const [all, mem, quota, host, stored] = await Promise.all([
      listThreads(),
      getMemory(),
      originStorage(),
      fetchHostStorage(),
      listAttachments(),
    ]);
    setThreads(all);
    setMemory(mem);
    setOrigin(quota);
    setHostStore(host);
    setFiles(stored);
    setActive((cur) => {
      const id = preferId || cur?.id;
      return all.find((t) => t.id === id) || all[0] || null;
    });
  }, []);

  const refreshHost = useCallback(async () => {
    try {
      let next = await health();
      if ((next.local_llm?.backend || next.ollama) && !next.platform?.instance) {
        try {
          await createLocalInstance("synap");
          next = await health();
        } catch {
          /* first chat can still use the in-browser model */
        }
      }
      setStatus(next);
    } catch {
      setStatus(null);
    }
  }, []);

  useEffect(() => {
    setGpu(webGpuOk());
    setDictateOk(canDictate());
    void load();
    void refreshHost();
    if (networkOnline()) warmBrowserEngine(setProgress);
    void fetchProfile().then((me) => {
      setProfile(me);
      if (!me && networkOnline()) setAuthOpen(true);
    });
    const onNet = () => {
      const up = networkOnline();
      setNetOn(up);
      if (up) {
        warmBrowserEngine(setProgress);
        void fetchProfile().then((me) => {
          setProfile(me);
          if (!me) setAuthOpen(true);
        });
        return;
      }
      setAuthOpen(false);
    };
    setNetOn(networkOnline());
    window.addEventListener("online", onNet);
    window.addEventListener("offline", onNet);
    const t = setInterval(() => void refreshHost(), 8000);
    return () => {
      clearInterval(t);
      window.removeEventListener("online", onNet);
      window.removeEventListener("offline", onNet);
    };
  }, [load, refreshHost]);

  useEffect(() => {
    const ready = !!(status?.local_llm?.backend || status?.ollama) && !!status.platform?.instance;
    setEngine(ready ? "ollama" : "browser");
  }, [status]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [active?.messages, busy]);

  async function persist(thread: Thread) {
    await saveThread(thread);
    setActive(thread);
    setThreads((all) => [thread, ...all.filter((t) => t.id !== thread.id)].sort((a, b) => b.updatedAt - a.updatedAt));
  }

  async function needProfile(): Promise<boolean> {
    if (!networkOnline()) return true;
    if (profile?.email_verified) return true;
    const me = await fetchProfile();
    if (me?.email_verified) {
      setProfile(me);
      return true;
    }
    setAuthOpen(true);
    return false;
  }

  async function addFiles(list: FileList | File[]) {
    if (!(await needProfile())) return;
    const incoming = [...list];
    if (!incoming.length) return;
    let thread = active;
    if (!thread) {
      thread = newThread();
      thread.title = titleFrom(incoming[0].name);
      await persist(thread);
    }
    const threadId = thread.id;
    const existing = (await listAttachments()).filter((f) => f.threadId === threadId);
    const room = Math.max(0, 40 - existing.length);
    const batch = incoming.slice(0, room);
    if (!batch.length) {
      setProgress("This chat can hold 40 files. Remove one first.");
      return;
    }
    setBusy(true);
    const storedOk: StoredAttachment[] = [];
    const failed: string[] = [];
    try {
      let mossed = 0;
      for (const file of batch) {
        setProgress(`Reading ${file.name} on this device…`);
        try {
          const stored = await ingestFile(file, threadId);
          await saveAttachment(stored);
          storedOk.push(stored);
          if (stored.text) {
            const ok = await indexMoss(
              `${stored.name}\n${stored.text.slice(0, 12000)}`,
              `file-${stored.name}`.slice(0, 80),
            );
            if (ok) mossed += 1;
          }
        } catch (err) {
          failed.push(file.name + (err instanceof Error ? `: ${err.message}` : ""));
        }
      }
      setFiles(await listAttachments());
      const bits = [`Attached ${storedOk.length} file(s) to this chat.`];
      if (mossed) bits.push(`Moss indexed ${mossed}.`);
      else if (storedOk.length) bits.push("Start the local host so Moss can index them.");
      if (failed.length) bits.push(`Skipped ${failed.length}: ${failed.slice(0, 3).join("; ")}`);
      setProgress(bits.join(" "));
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
      if (imageRef.current) imageRef.current.value = "";
    }
  }

  async function dropFile(id: string) {
    await deleteAttachment(id);
    setFiles((all) => all.filter((a) => a.id !== id));
  }

  async function addFromFilesOrFolder() {
    if (busy) return;
    if (!canUseFilePicker()) {
      fileRef.current?.click();
      return;
    }
    try {
      const picked = await pickFilesOrFolder();
      if (picked.length) await addFiles(picked);
    } catch (err) {
      if (err instanceof DOMException && (err.name === "AbortError" || err.name === "NotSupportedError")) {
        if (err.name === "NotSupportedError") fileRef.current?.click();
        return;
      }
      setProgress(err instanceof Error ? err.message : "Could not read those files.");
    }
  }

  async function startNew() {
    if (!(await needProfile())) return;
    const t = newThread();
    await persist(t);
  }

  async function remove(id: string) {
    await deleteThread(id);
    const all = await listThreads();
    setThreads(all);
    setActive((cur) => (cur?.id === id ? all[0] || null : cur));
    setFiles(await listAttachments());
  }

  async function compact() {
    if (!(await needProfile())) return;
    if (busy) return;
    const packed = packThreads(threads);
    if (!packed && !memory?.summary) {
      setProgress("Nothing to summarize yet.");
      return;
    }
    if (engine === "browser" && gpu === false) {
      setProgress("Use Chrome or Edge with WebGPU, or switch the engine to Ollama on this computer.");
      return;
    }
    const before = snapshotStats(threads, memory, files);
    setBusy(true);
    setProgress("Summarizing chats on this device…");
    try {
      let summary = "";
      const browserSummary = () =>
        completeBrowserChat(
          [
            {
              role: "system",
              content:
                "Write a short plain paragraph (max 120 words) of facts from these chats. No headings. Reply with the paragraph only.",
            },
            {
              role: "user",
              content: [
                memory?.summary ? `Existing retained memory:\n${memory.summary}` : "",
                packed ? `Chats to fold in:\n${packed}` : "",
              ]
                .filter(Boolean)
                .join("\n\n"),
            },
          ],
          setProgress,
        );
      if (engine === "ollama" && (status?.local_llm?.backend || status?.ollama) && status.platform?.instance) {
        try {
          const { conversation_id } = await streamChat({
            content:
              "Write a short plain paragraph (max 120 words) of facts from these chats. No headings. Do not use User Memory Note, Open Tasks, or Retained Information. Reply with the paragraph only.\n\n" +
              (memory?.summary ? `Existing retained memory:\n${memory.summary}\n\n` : "") +
              (packed ? `Chats to fold in:\n${packed}` : ""),
            onMeta: (m) => setTurnMeta(m),
            onDelta: (t) => {
              summary += t;
            },
          });
          void conversation_id;
        } catch (err) {
          if (!looksLikeNetworkFailure(err)) throw err;
          setProgress("Local host unreachable. Summarizing in this browser…");
          summary = await browserSummary();
        }
      } else {
        summary = await browserSummary();
      }
      if (!summary) throw new Error("The model returned an empty summary.");
      const note = summary
        .replace(/^#+\s*Compressed Chat History\s*/i, "")
        .replace(/Compress the user's local chat history[\s\S]*?Max 250 words\.?\s*/i, "")
        .trim()
        .slice(0, 4000);
      if (!note) throw new Error("The model returned an empty summary.");
      const saved = await saveMemory(note);
      const fresh = newThread();
      fresh.title = "Memory kept";
      await replaceThreads([fresh]);
      await reassignAttachments(
        threads.map((t) => t.id),
        fresh.id,
      );
      setMemory(saved);
      setThreads([fresh]);
      setActive(fresh);
      const kept = (await listAttachments()).map((a) => ({ ...a, threadId: fresh.id }));
      setFiles(kept);
      const after = snapshotStats([fresh], saved, kept);
      setLast({ kind: "summarize", before, after });
      setOrigin(await originStorage());
      setProgress(
        `Kept a ${after.memoryChars}-character summary. Chat text went from ${before.messages} messages (${before.chatBytes} B) to memory only (${after.memoryBytes} B).`,
      );
    } catch (err) {
      setProgress(err instanceof Error ? err.message : "Could not summarize.");
    } finally {
      setBusy(false);
      setWipeArmed(false);
    }
  }

  async function wipe() {
    if (!(await needProfile())) return;
    if (busy) return;
    if (!wipeArmed) {
      setWipeArmed(true);
      return;
    }
    setBusy(true);
    const before = snapshotStats(threads, memory, files);
    try {
      await wipeBrowserStore();
      const after: DataSnapshot = {
        chats: 0,
        messages: 0,
        chatBytes: 0,
        memoryBytes: 0,
        memoryChars: 0,
        fileCount: 0,
        fileBytes: 0,
      };
      setThreads([]);
      setActive(null);
      setMemory(null);
      setFiles([]);
      setWipeArmed(false);
      setLast({ kind: "erase", before, after });
      setOrigin(await originStorage());
      setProgress(
        `Erased ${before.messages} messages and ${before.memoryChars} characters of memory from this browser.`,
      );
    } catch (err) {
      setProgress(err instanceof Error ? err.message : "Could not delete local data.");
    } finally {
      setBusy(false);
    }
  }

  function toggleMic() {
    if (listening) {
      stopMic.current?.();
      stopMic.current = null;
      setListening(false);
      return;
    }
    if (!dictateOk) return;
    setListening(true);
    stopMic.current = startDictation({
      onInterim: () => undefined,
      onFinal: (t) => setInput((prev) => `${prev}${prev ? " " : ""}${t}`.trim()),
      onError: () => setListening(false),
    });
  }

  function stopReply() {
    abortRef.current?.abort();
  }

  async function send(preset?: string, fromThread?: Thread) {
    if (!(await needProfile())) return;
    const content = (preset ?? input).trim();
    let thread = fromThread || active;
    if (!thread) thread = newThread();
    const onDisk = (await listAttachments()).filter((f) => f.threadId === thread.id);
    const threadFiles = onDisk.length ? onDisk : files.filter((f) => f.threadId === thread.id);
    if ((!content && !threadFiles.length) || busy) return;
    const asked = sanitizeUserText(content || "Answer using the attached files on this chat.").text;
    if (wantsSavedSummary(asked)) {
      const note = memory?.summary?.trim();
      const reply = note
        ? note
        : "There is no saved summary yet. Use Save summary to keep one.";
      const working: Thread = {
        ...thread,
        title: thread.messages.length ? thread.title : titleFrom(asked),
        updatedAt: Date.now(),
        messages: [...thread.messages, { role: "user", content: asked }, { role: "assistant", content: reply }],
      };
      setInput("");
      await persist(working);
      return;
    }
    const ollamaOn = !!(status?.local_llm?.backend || status?.ollama) && !!status.platform?.instance;
    const hydrated: StoredAttachment[] = [];
    for (const f of threadFiles) {
      const next = await unpackZipIfNeeded(f);
      if (next.text !== f.text) await saveAttachment(next);
      hydrated.push(next);
    }
    if (hydrated.some((f) => f.text !== threadFiles.find((t) => t.id === f.id)?.text)) {
      setFiles(await listAttachments());
    }
    const zipStub = hydrated.filter(
      (f) => /\.zip$/i.test(f.name) && !/File tree|Extracted zip/i.test(f.text),
    );
    if (zipStub.length) {
      setProgress("This zip was attached before unpacking was added. Remove the zip chip, attach harbour-agent-OP1.zip again, then ask.");
      return;
    }
    if (wantsFileConvert(asked)) {
      const history: ChatMsg[] = [...thread.messages, { role: "user", content: asked }];
      const working: Thread = {
        ...thread,
        title: thread.messages.length ? thread.title : titleFrom(asked),
        updatedAt: Date.now(),
        messages: [
          ...history,
          { role: "assistant", content: FILE_CONVERT_UNSUPPORTED, engine: "browser" },
        ],
      };
      setInput("");
      await persist(working);
      return;
    }
    const named = hydrated.map((f) => ({ name: f.name, text: f.text || "" }));
    const thin = thinAttachmentReply(named);
    if (thin) {
      const history: ChatMsg[] = [...thread.messages, { role: "user", content: asked }];
      const working: Thread = {
        ...thread,
        title: thread.messages.length ? thread.title : titleFrom(asked),
        updatedAt: Date.now(),
        messages: [...history, { role: "assistant", content: thin, engine: "browser" }],
      };
      setInput("");
      await persist(working);
      return;
    }
    // llama3.2:1b often summarizes the system prompt instead of the file — give an extractive brief.
    const modelTag = status?.active_model || status?.default_model || "";
    const lightModel =
      /1b|1\.5b|in-browser/i.test(modelTag) ||
      (!status?.local_llm?.backend && !status?.ollama);
    if (named.length && wantsFileOverview(asked) && lightModel) {
      const brief = extractiveFileOverview(named);
      if (brief) {
        const history: ChatMsg[] = [...thread.messages, { role: "user", content: asked }];
        const working: Thread = {
          ...thread,
          title: thread.messages.length ? thread.title : titleFrom(asked),
          updatedAt: Date.now(),
          messages: [...history, { role: "assistant", content: brief, engine: ollamaOn ? "host" : "browser" }],
        };
        setInput("");
        await persist(working);
        return;
      }
    }
    const docs = retrieveFileContext(
      named,
      asked,
      ollamaOn ? OLLAMA_DOC_BUDGET : Math.max(BROWSER_DOC_BUDGET, 3500),
    );
    if (!ollamaOn && gpu === false) {
      setProgress("Use Chrome or Edge with WebGPU, or start Ollama on this computer.");
      return;
    }
    if (threadFiles.length && !docs) {
      setProgress("Those files are on this chat but no text could be read from them.");
    }
    const history: ChatMsg[] = [...thread.messages, { role: "user", content: asked }];
    const working: Thread = {
      ...thread,
      title: thread.messages.length ? thread.title : titleFrom(asked === "Answer using the attached files on this chat." ? threadFiles[0]?.name || asked : asked),
      updatedAt: Date.now(),
      messages: [...history, { role: "assistant", content: "" }],
    };
    setInput("");
    await persist(working);
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    setBusy(true);
    let startedAt = performance.now();
    setProgress(
      threadFiles.length
        ? `Using ${threadFiles.length} attached file(s) · ${ollamaOn ? status?.local_llm?.backend || "local" : "in-browser"} generating…`
        : ollamaOn
          ? `Moss retrieving · ${status?.local_llm?.backend || "Ollama"} generating…`
          : "Generating…",
    );
    try {
      if (docs && ollamaOn && getToken()) {
        for (const f of threadFiles) {
          if (f.text) void indexMoss(`${f.name}\n${f.text.slice(0, 4000)}`, `file-${f.name}`.slice(0, 80));
        }
      }
      startedAt = performance.now();
      const paint = (t: string) => {
        setActive((cur) => {
          if (!cur || cur.id !== working.id) return cur;
          return { ...cur, messages: appendAssistant(cur.messages, t) };
        });
      };
      const finish = (extra: Pick<ChatMsg, "waitMs" | "backendMs" | "engine">, conversation_id?: string) => {
        setActive((cur) => {
          if (!cur || cur.id !== working.id) return cur;
          const last = cur.messages[cur.messages.length - 1];
          let messages = stampReply(cur.messages, extra);
          if (
            named.length &&
            wantsFileOverview(asked) &&
            last?.role === "assistant" &&
            isMetaAgentNoise(last.content)
          ) {
            const rescue = extractiveFileOverview(named);
            if (rescue) {
              messages = messages.map((m, i, arr) =>
                i === arr.length - 1 && m.role === "assistant" ? { ...m, content: rescue, ...extra } : m,
              );
            }
          }
          const done = {
            ...cur,
            hostConversationId: conversation_id || cur.hostConversationId,
            updatedAt: Date.now(),
            messages,
          };
          void persist(done);
          return done;
        });
      };
      const runBrowser = async (skipMoss = false) => {
        if (!networkOnline() && !hasReadyBrowserEngine()) {
          const brief = offlineFileBrief(
            hydrated.map((f) => ({ name: f.name, text: f.text || "" })),
            asked,
            "offline",
          );
          if (brief) {
            paint(brief);
            finish({ waitMs: Math.round(performance.now() - startedAt), engine: "browser" });
            return;
          }
        }
        const extra = [docs, !docs && !skipMoss ? formatMossHits(await searchMoss(asked)) : ""]
          .filter(Boolean)
          .join("\n\n");
        const prior = trimTurns(thread.messages, BROWSER_TURN_BUDGET);
        try {
          await streamBrowserChat(
            fitBrowserPrompt(
              systemPrompt(memory, extra, BROWSER_MEMORY_BUDGET),
              prior,
              docs
                ? `${asked}\n\n(The folder listing is in the system context. Draw it. Do not say you lack access.)`
                : asked,
            ),
            paint,
            setProgress,
            abortRef.current?.signal,
          );
          finish({ waitMs: Math.round(performance.now() - startedAt), engine: "browser" });
        } catch (err) {
          if (isAbortError(err)) throw err;
          const brief = offlineFileBrief(
            hydrated.map((f) => ({ name: f.name, text: f.text || "" })),
            asked,
            networkOnline() ? "no-model" : "offline",
          );
          if (brief) {
            paint(brief);
            finish({ waitMs: Math.round(performance.now() - startedAt), engine: "browser" });
            return;
          }
          throw err;
        }
      };
      let usedHost = false;
      let skipMoss = !getToken();
      if (ollamaOn && getToken()) {
        try {
          const payload = [docs, docs ? `User question:\n${asked}` : asked]
            .filter(Boolean)
            .join("\n\n");
          const { conversation_id, latency_ms } = await streamChat({
            content: payload,
            conversation_id: working.hostConversationId,
            voice_input: listening,
            offline: true,
            signal: abortRef.current?.signal,
            onMeta: (m) => setTurnMeta(m),
            onDelta: paint,
          });
          usedHost = true;
          finish(
            {
              waitMs: Math.round(performance.now() - startedAt),
              backendMs: latency_ms,
              engine: "host",
            },
            conversation_id,
          );
        } catch (err) {
          if (isAbortError(err)) throw err;
          if (!looksLikeNetworkFailure(err)) throw err;
          setProgress("Local host unreachable. Continuing in this browser…");
          skipMoss = true;
          setActive((cur) => {
            if (!cur || cur.id !== working.id) return cur;
            return { ...cur, messages: setAssistant(cur.messages, "") };
          });
        }
      }
      if (!usedHost) await runBrowser(skipMoss);
    } catch (err) {
      if (isAbortError(err)) {
        setActive((cur) => {
          if (!cur || cur.id !== working.id) return cur;
          const msgs = cur.messages.map((m, i, arr) =>
            i === arr.length - 1 && m.role === "assistant"
              ? { ...m, content: m.content.trim() || "(stopped)" }
              : m,
          );
          const done = { ...cur, messages: msgs, updatedAt: Date.now() };
          void persist(done);
          return done;
        });
        return;
      }
      const detail = err instanceof Error ? parseApiError(err.message) : "The local model failed.";
      const waitMs = Math.round(performance.now() - startedAt);
      const failed = {
        ...working,
        messages: stampReply(setAssistant(working.messages, detail), {
          waitMs,
          engine: ollamaOn && getToken() ? "host" : "browser",
        }),
        updatedAt: Date.now(),
      };
      await persist(failed);
    } finally {
      abortRef.current = null;
      setBusy(false);
      setProgress("");
    }
  }

  const msgs = active?.messages || [];
  const empty = msgs.length === 0;
  const threadFiles = files.filter((f) => f.threadId === (active?.id || ""));
  const stats = snapshotStats(threads, memory, files);
  const engineLabel = status?.active_model || status?.default_model || "in-browser model";

  return (
    <div className="chat-shell">
      <aside className="chat-side">
        <Link href="/" className="brand">
          <BrandMark size={30} />
          Surf AI
        </Link>
        <button type="button" className="primary wide" onClick={() => void startNew()}>
          <Plus size={16} /> New chat
        </button>
        <div className="thread-list">
          {threads.map((t) => (
            <div key={t.id} className={`thread ${active?.id === t.id ? "on" : ""}`}>
              <button type="button" className="thread-open" onClick={() => setActive(t)}>
                {t.title}
              </button>
              <button type="button" className="icon" aria-label="Delete chat" onClick={() => void remove(t.id)}>
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
        <LocalEngines status={status} />
        <div className="memory-panel">
          <LocalDataCard stats={stats} origin={origin} last={last} host={hostStore} />
          <FeedbackInbox refreshKey={fbTick} />
          <button type="button" className="ghost wide" disabled={busy} onClick={() => void compact()}>
            Save a short summary and delete chats
          </button>
          <button type="button" className="danger wide" disabled={busy} onClick={() => void wipe()}>
            {wipeArmed ? "Click again to delete everything" : "Delete all chats and files"}
          </button>
        </div>
      </aside>

      <section
        className="chat-main"
        onDragOver={(e) => {
          e.preventDefault();
        }}
        onDrop={(e) => {
          e.preventDefault();
          if (!e.dataTransfer) return;
          void filesFromDataTransfer(e.dataTransfer).then((list) => {
            if (list.length) void addFiles(list);
          });
        }}
      >
        <header className="chat-head">
          <div>
            <div className="head-title">Chat</div>
            <div className="muted tiny">{engineLabel}</div>
          </div>
          <div className="head-actions">
            <button type="button" className="ghost" onClick={() => void startNew()}>
              <Plus size={14} /> New chat
            </button>
            <button
              type="button"
              className="ghost"
              onClick={() =>
                void needProfile().then((ok) => {
                  if (ok) void downloadOnThisDevice();
                })
              }
            >
              Download zip
            </button>
            <button type="button" className="ghost" disabled={busy} onClick={() => void compact()}>
              Save summary
            </button>
            <button type="button" className="ghost" disabled={busy} onClick={() => void wipe()}>
              {wipeArmed ? "Confirm delete" : "Delete data"}
            </button>
            <button
              type="button"
              className="ghost"
              onClick={() => {
                clearAccount();
                setProfile(null);
                setAuthOpen(true);
              }}
            >
              Sign out
            </button>
          </div>
        </header>

        {/1b|1\.5b|in-browser/i.test(engineLabel) || (!status?.local_llm?.backend && !status?.ollama) ? (
          <div className="light-model-note" role="note">
            <p>
              This light model (<strong>{/in-browser/i.test(engineLabel) ? "llama3.2:1b in the browser" : engineLabel}</strong>)
              keeps answers short. For fuller, more descriptive replies, use{" "}
              <strong>Download zip</strong> above and run Surf on a computer (Mac, Windows, or Linux).
              Phones cannot run the setup command — use chat in this browser on mobile.
            </p>
          </div>
        ) : null}

        <div ref={logRef} className="chat-log">
          <OfflineBanner stayLabel="Keep using this chat" />
          <div className="mobile-only">
            <LocalEngines status={status} />
            <LocalDataCard stats={stats} origin={origin} last={last} host={hostStore} />
            <FeedbackInbox refreshKey={fbTick} />
          </div>
          {empty && (
            <div className="empty">
              <h1>Ask anything</h1>
              <p className="muted">
                Attach files or ask a question. Answers stay on your device.
              </p>
              {gpu === false && engine === "browser" && (
                <p className="warn">
                  This browser cannot run the in-page model. Use Chrome or Edge, or start Ollama on
                  this computer.
                </p>
              )}
            </div>
          )}
          {msgs.map((m, i) => {
            const waiting = busy && i === msgs.length - 1 && m.role === "assistant" && !m.content;
            if (waiting) {
              return <ThinkingBubble key={`${m.role}-${i}`} label={progress || "Thinking"} />;
            }
            const lastAssistant = m.role === "assistant" && i === msgs.length - 1;
            return (
              <div key={`${m.role}-${i}`} className={`bubble-wrap ${m.role}`}>
                {m.role === "user" && editIdx === i ? (
                  <div className="bubble user edit-bubble">
                    <textarea
                      className="edit-prompt"
                      value={editDraft}
                      rows={3}
                      onChange={(e) => setEditDraft(e.target.value)}
                    />
                    <div className="bubble-actions">
                      <button
                        type="button"
                        className="linkish"
                        disabled={!editDraft.trim()}
                        onClick={() => {
                          const text = editDraft.trim();
                          const thread = active;
                          if (!thread || !text) return;
                          const next = {
                            ...thread,
                            messages: thread.messages.slice(0, i),
                            updatedAt: Date.now(),
                          };
                          setEditIdx(null);
                          setEditDraft("");
                          void persist(next).then(() => send(text, next));
                        }}
                      >
                        Save and send
                      </button>
                      <button type="button" className="linkish" onClick={() => setEditIdx(null)}>
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className={`bubble ${m.role}`}>
                      {m.role === "assistant" ? <MarkdownBody text={m.content} /> : m.content}
                    </div>
                    {m.role === "user" && !busy && (
                      <button
                        type="button"
                        className="linkish edit-msg"
                        onClick={() => {
                          setEditIdx(i);
                          setEditDraft(m.content);
                        }}
                      >
                        <Pencil size={12} /> Edit
                      </button>
                    )}
                  </>
                )}
                {lastAssistant && turnMeta?.sources && turnMeta.sources.length > 0 && (
                  <div className="tiny muted cite">
                    Used {turnMeta.sources.map((s) => s.title).filter(Boolean).join(", ")}
                    {turnMeta.moss?.time_taken_ms
                      ? ` · Moss ${turnMeta.moss.time_taken_ms} ms`
                      : ""}
                    {turnMeta.model ? ` · ${turnMeta.model}` : ""}
                  </div>
                )}
                {m.role === "assistant" && m.content && replyTimeLabel(m) && (
                  <div className="tiny muted msg-time">{replyTimeLabel(m)}</div>
                )}
                {m.role === "assistant" && m.content && (
                  <MessageFeedback
                    conversationId={active?.hostConversationId}
                    engine={engine}
                    onSent={() => setFbTick((n) => n + 1)}
                  />
                )}
              </div>
            );
          })}
          {busy && !msgs.some((m) => m.role === "assistant" && !m.content) && (
            <ThinkingBubble label={progress || "Thinking"} />
          )}
          {lkStatus && <div className="progress">{lkStatus}</div>}
        </div>

        <div className="composer">
          {status?.livekit?.reachable && netOn && (
            <div className="voice-row">
              <VoiceRoom enabled={listening} onStatus={setLkStatus} />
            </div>
          )}
          <div className="composer-wrap">
            <AttachmentBar files={threadFiles} onRemove={(id) => void dropFile(id)} />
            <div className="composer-box">
              <input
                ref={fileRef}
                type="file"
                hidden
                multiple
                onChange={(e) => {
                  if (e.target.files?.length) void addFiles(e.target.files);
                }}
              />
              <input
                ref={imageRef}
                type="file"
                hidden
                multiple
                accept="image/*,image/heic,image/heif,.heic,.heif,.png,.jpg,.jpeg,.gif,.webp,.bmp,.avif"
                onChange={(e) => {
                  if (e.target.files?.length) void addFiles(e.target.files);
                }}
              />
              <div className="attach-one">
                <button
                  type="button"
                  className="icon"
                  aria-label="Attach"
                  title="Attach files, a folder, or photos"
                  disabled={busy}
                  onClick={() => setAttachOpen((v) => !v)}
                >
                  <Paperclip size={16} />
                </button>
                {attachOpen && (
                  <div className="attach-menu">
                    <button
                      type="button"
                      onClick={() => {
                        setAttachOpen(false);
                        void addFromFilesOrFolder();
                      }}
                    >
                      Files or folder
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setAttachOpen(false);
                        imageRef.current?.click();
                      }}
                    >
                      <span className="attach-menu-row">
                        <ImagePlus size={14} /> Upload image
                      </span>
                    </button>
                  </div>
                )}
              </div>
              <textarea
                value={input}
                rows={1}
                placeholder={threadFiles.length ? "Ask about the attached files…" : "Message…"}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    if (!busy) void send();
                  }
                }}
              />
              <button type="button" className="icon" onClick={toggleMic} disabled={!dictateOk || busy}>
                {listening ? <MicOff size={16} /> : <Mic size={16} />}
              </button>
              {busy ? (
                <button type="button" className="send stop" aria-label="Stop" title="Stop" onClick={stopReply}>
                  <Square size={14} fill="currentColor" />
                </button>
              ) : (
                <button
                  type="button"
                  className="send"
                  disabled={!input.trim() && !threadFiles.length}
                  onClick={() => void send()}
                >
                  <Send size={16} />
                </button>
              )}
            </div>
          </div>
        </div>
      </section>
      <AuthDialog
        open={authOpen}
        allowSkip
        onClose={() => setAuthOpen(false)}
        onAuthed={(user) => {
          setProfile(user);
          setAuthOpen(false);
          authNext?.();
          setAuthNext(null);
        }}
      />
    </div>
  );
}
