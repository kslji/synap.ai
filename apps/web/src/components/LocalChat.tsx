"use client";

import { Mic, Paperclip, Pencil, Plus, Send, Square, Trash2, Download } from "lucide-react";
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
  packThreadTitles,
  appendMemoryBatch,
  memoryPromptText,
  memoryDisplayText,
  saveAttachment,
  saveThread,
  snapshotStats,
  titleFrom,
  wipeBrowserStore,
  clearAllAttachments,
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
  OLLAMA_LIGHT_DOC_BUDGET,
  extractiveFileOverview,
  repairLoopedReply,
  groundAttachedFileReply,
  presentQuestionList,
  looksLikeQuestionDump,
  extractiveFactAnswer,
  extractiveInterviewQuestions,
  architectureFlowFromFiles,
  groundedSystem,
  isLightModelTag,
  isMetaAgentNoise,
  isOverRefusal,
  needsDocumentFirstRedirect,
  documentFirstRedirect,
  wantsOpenAdviceWithoutSource,
  isShortAffirmation,
  looksLikeSoftHedgeRefusal,
  overRefusalRetryHint,
  stripRefusalContamination,
  retrieveFileContext,
  filesNamedInAsk,
  thinAttachmentReply,
  asksAboutAttachedFiles,
  isCasualGeneralAsk,
  trimTurns,
  fitBrowserPrompt,
  offlineFileBrief,
  wantsFileOverview,
  wantsDiagram,
  wantsFileConvert,
  wantsInterviewQuestions,
  wantsShortFact,
  normalizeUserAsk,
  FILE_CONVERT_UNSUPPORTED,
  wantsSavedSummary,
} from "@/lib/groundedContext";
import { canUseFilePicker, filesFromDataTransfer, pickFilesOrFolder } from "@/lib/deviceFolder";
import { buildManifest } from "@/lib/agentPacks";
import { downloadOnThisDevice } from "@/lib/openOnDevice";
import { fetchHostStorage, health, indexMoss, parseApiError, searchMoss, streamChat, eraseHostData, createLocalInstance, saveHostSummary, exportHostSummaries, type Health } from "@/lib/api";
import { fetchProfile, clearAccount, type UserProfile } from "@/lib/account";
import { isAbortError, looksLikeNetworkFailure, networkOnline } from "@/lib/net";
import { AuthDialog } from "./AuthDialog";
import { OfflineBanner } from "./OfflineBanner";
import { AttachmentBar } from "./AttachmentBar";
import { CopyReplyButton } from "./CopyReplyButton";
import { FeedbackInbox } from "./FeedbackInbox";
import { MessageFeedback } from "./MessageFeedback";
import { LocalDataCard, type LastChange } from "./LocalDataCard";
import { LocalEngines, type LocalEngine } from "./LocalEngines";
import { MarkdownBody } from "./MarkdownBody";
import { ThinkingBubble } from "./ThinkingBubble";
import { VoiceRoom } from "./VoiceRoom";
import { canDictate, startDictation } from "@/lib/dictation";
import { isBrowserModelProgress, webGpuOk, allowInBrowserLlm, LOCAL_HOST_HINT } from "@/lib/browserCaps";
import { replyTimeLabel } from "@/lib/responseTime";
import { BrandMark } from "./BrandMark";

/** Load WebLLM only when an in-browser reply/summary actually needs it (never on /chat open). */
async function browserLlm() {
  return import(
    /* webpackChunkName: "surf-webllm" */
    "@/lib/webllm"
  );
}

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
  return groundedSystem(memoryPromptText(memory, memoryBudget), extra, memoryBudget);
}

function formatMossHits(hit: { docs?: Array<{ text?: string }>; time_taken_ms?: number; backend?: string } | null): string {
  if (!hit?.docs?.length) return "";
  const lines = hit.docs.slice(0, 6).map((d, i) => `${i + 1}. ${(d.text || "").slice(0, 500)}`);
  return `\n\nMoss text-document retrieval (${hit.time_taken_ms ?? "?"} ms, ${hit.backend || "local"}):\n${lines.join("\n")}`;
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
  const stopMic = useRef<(() => void) | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const genIdRef = useRef(0);
  const stickBottomRef = useRef(true);
  const scrollRafRef = useRef(0);

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
    // Do NOT prefetch WebLLM on load — CreateMLCEngine freezes the tab while
    // downloading/compiling ~700MB. Load only on the first in-browser reply.
    void fetchProfile().then((me) => setProfile(me));
    const onNet = () => {
      const up = networkOnline();
      setNetOn(up);
      if (up) {
        void fetchProfile().then((me) => setProfile(me));
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

  const scrollLogToBottom = useCallback((force = false) => {
    const el = logRef.current;
    if (!el) return;
    if (!force && !stickBottomRef.current) return;
    if (scrollRafRef.current) cancelAnimationFrame(scrollRafRef.current);
    scrollRafRef.current = requestAnimationFrame(() => {
      scrollRafRef.current = 0;
      const node = logRef.current;
      if (!node) return;
      if (!force && !stickBottomRef.current) return;
      // Instant jump (not smooth) — smooth + token stream feels irregular.
      node.scrollTop = node.scrollHeight;
    });
  }, []);

  useEffect(() => {
    const el = logRef.current;
    if (!el) return;
    const onScroll = () => {
      const gap = el.scrollHeight - el.scrollTop - el.clientHeight;
      stickBottomRef.current = gap < 120;
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [active?.id]);

  useEffect(() => {
    scrollLogToBottom(false);
  }, [active?.messages, busy, progress, scrollLogToBottom]);

  useEffect(() => {
    return () => {
      if (scrollRafRef.current) cancelAnimationFrame(scrollRafRef.current);
    };
  }, []);

  async function persist(thread: Thread) {
    await saveThread(thread);
    setActive(thread);
    setThreads((all) => [thread, ...all.filter((t) => t.id !== thread.id)].sort((a, b) => b.updatedAt - a.updatedAt));
  }

  /** Account required for download + chat features. After OTP, runs `then` if provided. */
  async function requireAccount(then?: () => void): Promise<boolean> {
    if (profile?.email_verified) {
      then?.();
      return true;
    }
    try {
      const me = await fetchProfile();
      if (me?.email_verified) {
        setProfile(me);
        then?.();
        return true;
      }
    } catch {
      /* stay gated */
    }
    setAuthNext(() => then ?? null);
    setAuthOpen(true);
    return false;
  }

  async function addFiles(list: FileList | File[]) {
    if (!(await requireAccount())) return;
    const incoming = [...list];
    if (!incoming.length) return;
    const isImage = (f: File) =>
      (f.type && f.type.startsWith("image/") && f.type !== "image/svg+xml") ||
      /\.(png|jpe?g|gif|webp|heic|heif|bmp|avif|tiff?)$/i.test(f.name);
    const images = incoming.filter(isImage);
    const docs = incoming.filter((f) => !isImage(f));
    if (images.length && !docs.length) {
      setProgress(
        "Image upload is turned off for now — Surf cannot see picture pixels. Attach a PDF, Word, Excel, text, or zip instead.",
      );
      return;
    }
    if (!docs.length) return;
    let thread = active;
    if (!thread) {
      thread = newThread();
      thread.title = titleFrom(docs[0].name);
      await persist(thread);
    }
    const threadId = thread.id;
    const existing = (await listAttachments()).filter((f) => f.threadId === threadId);
    const room = Math.max(0, 40 - existing.length);
    const batch = docs.slice(0, room);
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
      if (images.length) bits.push(`Skipped ${images.length} image(s) — image upload is off for now.`);
      if (mossed) {
        bits.push(
          networkOnline()
            ? `Moss indexed ${mossed} (SDK retrieval when online; keyword if offline).`
            : `Indexed ${mossed} on this device for offline keyword search.`,
        );
      } else if (storedOk.length) {
        bits.push("File is on this chat. Start local host to index in Moss.");
      }
      if (failed.length) bits.push(`Skipped ${failed.length}: ${failed.slice(0, 3).join("; ")}`);
      setProgress(bits.join(" "));
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
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
    genIdRef.current += 1;
    setBusy(false);
    setProgress("");
    setActive((cur) => {
      if (!cur) return cur;
      const last = cur.messages[cur.messages.length - 1];
      if (!last || last.role !== "assistant") return cur;
      const msgs = cur.messages.map((m, i, arr) =>
        i === arr.length - 1 && m.role === "assistant"
          ? { ...m, content: m.content.trim() || "(stopped)" }
          : m,
      );
      const done = { ...cur, messages: msgs, updatedAt: Date.now() };
      void persist(done);
      return done;
    });
  }

  async function compact() {
    if (!(await requireAccount())) return;
    if (busy) stopReply();
    const packed = packThreads(threads);
    if (!packed) {
      setProgress("Nothing new to summarize — start a chat first.");
      return;
    }
    if (engine === "browser" && allowInBrowserLlm() && gpu === false) {
      setProgress("Open this in Google Chrome only (WebGPU), or switch the engine to Ollama on this computer.");
      return;
    }
    if (engine === "browser" && !allowInBrowserLlm() && !(status?.local_llm?.backend || status?.ollama)) {
      setProgress(LOCAL_HOST_HINT);
      return;
    }
    const batchTitles = packThreadTitles(threads);
    const batchThreadIds = new Set(
      threads.filter((t) => t.messages.some((m) => m.content.trim())).map((t) => t.id),
    );
    const batchFileNames = [
      ...new Set(
        files.filter((f) => batchThreadIds.has(f.threadId)).map((f) => f.name.trim()).filter(Boolean),
      ),
    ];
    const before = snapshotStats(threads, memory, files);
    const summarizeAbort = new AbortController();
    abortRef.current = summarizeAbort;
    setBusy(true);
    setTurnMeta(null);
    setProgress("Summarizing this batch of chats on this device…");
    const fileLine = batchFileNames.length
      ? `Files attached to these chats only:\n${batchFileNames.map((n) => `- ${n}`).join("\n")}`
      : "Files attached to these chats only: (none)";
    const summarizeBrief =
      "Write a short plain paragraph (max 120 words) of facts from THIS batch of chats only. " +
      "Do not mention files that are not listed below. Do not recall older summaries. " +
      "No headings. Reply with the paragraph only.";
    const summarizeBody = [fileLine, `Chats to fold in:\n${packed}`].join("\n\n");
    try {
      let summary = "";
      const browserSummary = async () => {
        const { completeBrowserChat } = await browserLlm();
        return completeBrowserChat(
          [
            {
              role: "system",
              content: summarizeBrief,
            },
            {
              role: "user",
              content: summarizeBody,
            },
          ],
          setProgress,
        );
      };
      if (engine === "ollama" && (status?.local_llm?.backend || status?.ollama) && status.platform?.instance) {
        try {
          const { conversation_id } = await streamChat({
            content: `${summarizeBrief}\n\n${summarizeBody}`,
            signal: summarizeAbort.signal,
            // Ignore Moss meta — summarize must not show “Used …” from the host index.
            onMeta: () => undefined,
            onDelta: (t) => {
              if (summarizeAbort.signal.aborted) return;
              summary += t;
            },
          });
          void conversation_id;
        } catch (err) {
          if (isAbortError(err)) throw err;
          if (!looksLikeNetworkFailure(err)) throw err;
          setProgress("Local host unreachable. Summarizing in this browser…");
          summary = await browserSummary();
        }
      } else {
        summary = await browserSummary();
      }
      if (summarizeAbort.signal.aborted) throw new DOMException("Stopped", "AbortError");
      if (!summary) throw new Error("The model returned an empty summary.");
      const note = summary
        .replace(/^#+\s*Compressed Chat History\s*/i, "")
        .replace(/Compress the user's local chat history[\s\S]*?Max 250 words\.?\s*/i, "")
        .trim()
        .slice(0, 4000);
      if (!note) throw new Error("The model returned an empty summary.");
      // Append a NEW batch — never fold older notes / older files into this text.
      const saved = await appendMemoryBatch({
        text: note,
        chatTitles: batchTitles,
        fileNames: batchFileNames,
      });
      const fresh = newThread();
      fresh.title = "Memory kept";
      await replaceThreads([fresh]);
      await clearAllAttachments();
      setMemory(saved);
      setThreads([fresh]);
      setActive(fresh);
      setFiles([]);
      setTurnMeta(null);
      const after = snapshotStats([fresh], saved, []);
      setLast({
        kind: "summarize",
        before,
        after,
        batch: { fileNames: batchFileNames, chatTitles: batchTitles },
      });
      setOrigin(await originStorage());
      const latest = saved.batches[saved.batches.length - 1];
      const fileBit = batchFileNames.length
        ? ` Files in this summary: ${batchFileNames.join(", ")}.`
        : " No files in this summary.";
      try {
        await saveHostSummary({
          title: batchTitles[0] || "Saved summary",
          body: note,
          source: "compact",
        });
        await exportHostSummaries();
      } catch {
        /* local host may be down — browser memory still saved */
      }
      setProgress(
        `Kept a ${(latest?.text.length || note.length)}-character note for this batch.${fileBit} Chats and files cleared from this browser.`,
      );
      await eraseHostData();
      void health().then((h) => setStatus(h)).catch(() => undefined);
    } catch (err) {
      if (isAbortError(err)) {
        setProgress("Summarize stopped.");
        return;
      }
      setProgress(err instanceof Error ? err.message : "Could not summarize.");
    } finally {
      if (abortRef.current === summarizeAbort) abortRef.current = null;
      setBusy(false);
      setWipeArmed(false);
    }
  }

  async function wipe() {
    if (!(await requireAccount())) return;
    if (busy) stopReply();
    if (!wipeArmed) {
      setWipeArmed(true);
      setProgress("Click Delete again to erase all chats and files from this browser.");
      return;
    }
    setBusy(true);
    const before = snapshotStats(threads, memory, files);
    try {
      await wipeBrowserStore();
      await eraseHostData();
      // Re-verify IndexedDB is empty (deleteDatabase can be blocked by open tabs).
      const leftoverThreads = await listThreads().catch(() => [] as Thread[]);
      const leftoverFiles = await listAttachments().catch(() => [] as StoredAttachment[]);
      const leftoverMem = await getMemory().catch(() => null);
      if (leftoverThreads.length || leftoverFiles.length || leftoverMem) {
        await replaceThreads([]).catch(() => undefined);
        await clearAllAttachments().catch(() => undefined);
        await wipeBrowserStore();
      }
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
      setInput("");
      setTurnMeta(null);
      setLast({ kind: "erase", before, after });
      setWipeArmed(false);
      setOrigin(await originStorage());
      const verifiedEmpty =
        (await listThreads()).length === 0 &&
        (await listAttachments()).length === 0 &&
        !(await getMemory());
      setProgress(
        verifiedEmpty
          ? `Erased ${before.messages} messages and ${before.fileCount} file(s) from this browser (and cleared this browser’s Moss / host chat slice).`
          : "Tried to erase browser data — close other Surf tabs and click Delete again if anything remains.",
      );
      void health().then((h) => setStatus(h)).catch(() => undefined);
    } catch (err) {
      setProgress(err instanceof Error ? err.message : "Could not delete local data.");
    } finally {
      setBusy(false);
    }
  }

  async function send(preset?: string, fromThread?: Thread) {
    if (!(await requireAccount())) return;
    const content = (preset ?? input).trim();
    let thread = fromThread || active;
    if (!thread) thread = newThread();
    const onDisk = (await listAttachments()).filter((f) => f.threadId === thread.id);
    const threadFiles = onDisk.length ? onDisk : files.filter((f) => f.threadId === thread.id);
    if ((!content && !threadFiles.length) || busy) return;
    const asked = normalizeUserAsk(
      sanitizeUserText(content || "Answer using the attached files on this chat.").text,
    );
    if (wantsSavedSummary(asked)) {
      const note = memoryDisplayText(memory);
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
    const priorAssistant = [...thread.messages].reverse().find((m) => m.role === "assistant")?.content || "";
    // Surf is document-local: open advice / soft-hedge loops → ask for a file or pasted source.
    if (
      !threadFiles.length &&
      (wantsOpenAdviceWithoutSource(asked) ||
        (isShortAffirmation(asked) && looksLikeSoftHedgeRefusal(priorAssistant)))
    ) {
      const reply = documentFirstRedirect(
        isShortAffirmation(asked) ? undefined : asked.replace(/[?!.]+$/g, "").trim(),
      );
      const working: Thread = {
        ...thread,
        title: thread.messages.length ? thread.title : titleFrom(asked),
        updatedAt: Date.now(),
        messages: [
          ...thread.messages,
          { role: "user", content: asked },
          { role: "assistant", content: reply, engine: ollamaOn ? "host" : "browser" },
        ],
      };
      setInput("");
      await persist(working);
      return;
    }
    const hydrated: StoredAttachment[] = [];
    for (const f of threadFiles) {
      const next = await unpackZipIfNeeded(f);
      if (next.text !== f.text) await saveAttachment(next);
      hydrated.push(next);
    }
    if (hydrated.some((f) => f.text !== threadFiles.find((t) => t.id === f.id)?.text)) {
      setFiles(await listAttachments());
    }
    const zipStub = hydrated.filter((f) => {
      if (!/\.zip$/i.test(f.name)) return false;
      const t = f.text || "";
      if (!/File tree|Extracted zip/i.test(t)) return true;
      // Header present but no bullet paths / excerpts — unpack failed (e.g. old data-descriptor bug).
      return !/^-\s+\S+/m.test(t) && !/---\s+\S+\s+---/.test(t);
    });
    if (zipStub.length) {
      setProgress(
        "This zip could not be unpacked into a file tree. Remove the zip chip, attach it again, then ask.",
      );
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
    const allAttached = hydrated.map((f) => ({ name: f.name, text: f.text || "" }));
    // If the ask names a file (e.g. "harbour"), ground only on that attachment — not siblings.
    const scoped = filesNamedInAsk(allAttached, asked);
    const named = scoped.length ? scoped : allAttached;
    const thin = named.length && !wantsInterviewQuestions(asked) ? thinAttachmentReply(named, asked) : null;
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
      isLightModelTag(modelTag) || (!status?.local_llm?.backend && !status?.ollama);
    if (named.length && wantsDiagram(asked)) {
      const diagram = architectureFlowFromFiles(named);
      if (diagram) {
        const history: ChatMsg[] = [...thread.messages, { role: "user", content: asked }];
        const working: Thread = {
          ...thread,
          title: thread.messages.length ? thread.title : titleFrom(asked),
          updatedAt: Date.now(),
          messages: [...history, { role: "assistant", content: diagram, engine: ollamaOn ? "host" : "browser" }],
        };
        setInput("");
        await persist(working);
        return;
      }
    }
    if (named.length && wantsShortFact(asked)) {
      const fact = extractiveFactAnswer(named, asked);
      if (fact) {
        const history: ChatMsg[] = [...thread.messages, { role: "user", content: asked }];
        const working: Thread = {
          ...thread,
          title: thread.messages.length ? thread.title : titleFrom(asked),
          updatedAt: Date.now(),
          messages: [...history, { role: "assistant", content: fact, engine: ollamaOn ? "host" : "browser" }],
        };
        setInput("");
        await persist(working);
        return;
      }
    }
    // Interview asks: always use extractive grounding when files are attached —
    // light models and offline stubs often miss "interviewer" / resume phrasing.
    if (named.length && wantsInterviewQuestions(asked)) {
      const qs = extractiveInterviewQuestions(named, asked);
      if (qs) {
        const history: ChatMsg[] = [...thread.messages, { role: "user", content: asked }];
        const working: Thread = {
          ...thread,
          title: thread.messages.length ? thread.title : titleFrom(asked),
          updatedAt: Date.now(),
          messages: [...history, { role: "assistant", content: qs, engine: ollamaOn ? "host" : "browser" }],
        };
        setInput("");
        await persist(working);
        return;
      }
    }
    // Purpose-first overview for attached files — always extractive so light models
    // (Qwen 1.5B / llama 1B) cannot dump the wrong file or invent a fake diagram summary.
    if (
      named.length &&
      wantsFileOverview(asked) &&
      !wantsDiagram(asked)
    ) {
      const brief = extractiveFileOverview(named);
      if (brief) {
        const history: ChatMsg[] = [...thread.messages, { role: "user", content: asked }];
        const working: Thread = {
          ...thread,
          title: thread.messages.length ? thread.title : titleFrom(asked),
          updatedAt: Date.now(),
          messages: [
            ...history,
            { role: "assistant", content: brief, engine: ollamaOn ? "host" : "browser" },
          ],
        };
        setInput("");
        await persist(working);
        return;
      }
    }
    const docs =
      named.length && !isCasualGeneralAsk(asked)
        ? retrieveFileContext(
            named,
            asked,
            ollamaOn
              ? lightModel
                ? OLLAMA_LIGHT_DOC_BUDGET
                : OLLAMA_DOC_BUDGET
              : Math.max(BROWSER_DOC_BUDGET, 3500),
          )
        : "";
    // Name-only stubs only when the user is asking about files — otherwise greetings hit the
    // host “thin file” canned reply. Usable docs still skip Moss via fileGround.
    const fileGround =
      docs ||
      (threadFiles.length && asksAboutAttachedFiles(asked)
        ? threadFiles.map((f) => `### ${f.name}`).join("\n\n")
        : "");
    if (!ollamaOn && allowInBrowserLlm() && gpu === false) {
      setProgress("Open this in Google Chrome only (WebGPU), or start Ollama on this computer.");
      return;
    }
    if (threadFiles.length && !docs && asksAboutAttachedFiles(asked)) {
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
    const myGen = ++genIdRef.current;
    const stillThisGen = () => myGen === genIdRef.current && !abortRef.current?.signal.aborted;
    stickBottomRef.current = true;
    scrollLogToBottom(true);
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
      // Index into this browser's Moss slice (device JWT or email JWT — host tags owner from sub).
      if (docs && ollamaOn) {
        for (const f of threadFiles) {
          if (f.text) void indexMoss(`${f.name}\n${f.text.slice(0, 4000)}`, `file-${f.name}`.slice(0, 80));
        }
      }
      startedAt = performance.now();
      const paint = (t: string) => {
        if (!stillThisGen()) return;
        setActive((cur) => {
          if (!cur || cur.id !== working.id) return cur;
          return { ...cur, messages: appendAssistant(cur.messages, t) };
        });
      };
      const finish = (extra: Pick<ChatMsg, "waitMs" | "backendMs" | "engine">, conversation_id?: string) => {
        if (!stillThisGen()) return;
        setActive((cur) => {
          if (!cur || cur.id !== working.id) return cur;
          const last = cur.messages[cur.messages.length - 1];
          let messages = stampReply(cur.messages, extra);
          if (last?.role === "assistant" && last.content) {
            let content = last.content;
            // Guideline + fixed iterations: always repair light-model / overview loops (any file type).
            if (lightModel || wantsFileOverview(asked) || !networkOnline()) {
              content = repairLoopedReply(content, {
                files: named,
                preferExtractiveOverview: Boolean(named.length && wantsFileOverview(asked)),
              });
            } else if (named.length && isMetaAgentNoise(content)) {
              const rescue = extractiveFileOverview(named);
              if (rescue) content = rescue;
            }
            // Hallucination gate for attached files — extractive rescue only when clearly ungrounded.
            if (named.length) {
              content = groundAttachedFileReply(content, named, asked, { lightModel });
            }
            // Every model: question replies must be a clean numbered list.
            if (wantsInterviewQuestions(asked) || looksLikeQuestionDump(content)) {
              content = presentQuestionList(content, asked);
            }
            // Tiny models soft-hedge (“cannot provide financial advice… would that help?”) or over-refuse.
            // Surf’s answer: ask for a document/link text to summarize — don’t invent advice.
            if (
              needsDocumentFirstRedirect(content, asked, {
                hasFiles: named.length > 0,
                priorAssistant,
              })
            ) {
              content = documentFirstRedirect(asked.replace(/[?!.]+$/g, "").trim());
            } else if (isOverRefusal(content, asked)) {
              content = documentFirstRedirect(asked.replace(/[?!.]+$/g, "").trim());
            }
            if (content !== last.content) {
              messages = messages.map((m, i, arr) =>
                i === arr.length - 1 && m.role === "assistant" ? { ...m, content, ...extra } : m,
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
        // Production hosts never load WebLLM — it freezes the tab. Prefer extractive / file briefs.
        const useWebLlm = allowInBrowserLlm() && webGpuOk();
        if (!useWebLlm) {
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
          if (!fileGround && !docs) {
            paint(
              `${LOCAL_HOST_HINT}\n\n` +
                `Meanwhile: attach a file for grounded answers on this device.`,
            );
            finish({ waitMs: Math.round(performance.now() - startedAt), engine: "browser" });
            return;
          }
          // Attached files but no extractive hit — still refuse to load WebLLM.
          paint(
            `I can use the attached file text without the heavy in-browser model. Try a more specific question, or start Ollama / Download zip for fuller AI replies.`,
          );
          finish({ waitMs: Math.round(performance.now() - startedAt), engine: "browser" });
          return;
        }
        // Prefer WebLLM from Chrome cache when offline — document expert, not a file dump.
        if (!webGpuOk()) {
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
        }
        // Never pull host Moss when this chat already has attachments — shared demo index
        // must not mix another user's files into an attached-file turn.
        const mossExtra =
          !fileGround && !skipMoss
            ? formatMossHits(await searchMoss(asked, { offline: !networkOnline() }))
            : "";
        const extra = [docs, mossExtra].filter(Boolean).join("\n\n");
        const prior = trimTurns(
          stripRefusalContamination(
            thread.messages.map((m) => ({ role: m.role, content: m.content })),
            asked,
          ),
          BROWSER_TURN_BUDGET,
        );
        const userAsk = docs
          ? wantsShortFact(asked)
            ? `${asked}\n\n(Answer as a human expert in one short line from the attached text. Cite [filename]. Do not paste the file.)`
            : `${asked}\n\n(Explain what this file is for and why key fields/scripts/sections exist. Teach briefly. Cite [filename]. Do NOT paste the raw file or JSON.)`
          : asked;
        let buf = "";
        const paintBuf = (t: string) => {
          buf += t;
          paint(t);
        };
        try {
          const { streamBrowserChat } = await browserLlm();
          await streamBrowserChat(
            fitBrowserPrompt(systemPrompt(memory, extra, BROWSER_MEMORY_BUDGET), prior, userAsk),
            paintBuf,
            setProgress,
            abortRef.current?.signal,
          );
          // One retry if the 1B model copied a prior harm refusal onto a benign ask.
          if (isOverRefusal(buf, asked) && !docs) {
            buf = "";
            setActive((cur) => {
              if (!cur || cur.id !== working.id) return cur;
              return { ...cur, messages: setAssistant(cur.messages, "") };
            });
            setProgress("Rephrasing a clearer answer…");
            await streamBrowserChat(
              fitBrowserPrompt(
                systemPrompt(memory, "", BROWSER_MEMORY_BUDGET) + "\n\n" + overRefusalRetryHint(asked),
                [],
                asked,
              ),
              paintBuf,
              setProgress,
              abortRef.current?.signal,
            );
          }
          if (fileGround && !docs) {
            setTurnMeta({
              sources: threadFiles.map((f) => ({ title: f.name, kind: "file" })),
              moss: { backend: "skipped", time_taken_ms: 0, hits: 0 },
              model: engineLabel,
            });
          }
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
      let skipMoss = false;
      if (ollamaOn) {
        try {
          const payload = [fileGround, fileGround ? `User question:\n${asked}` : asked]
            .filter(Boolean)
            .join("\n\n");
          const { conversation_id, latency_ms } = await streamChat({
            content: payload,
            conversation_id: working.hostConversationId,
            voice_input: listening,
            // Online → Moss SDK first; offline → host uses local keyword fallback.
            // When fileGround is set, host skips Moss entirely (attached files only).
            offline: !networkOnline(),
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
          engine: ollamaOn ? "host" : "browser",
        }),
        updatedAt: Date.now(),
      };
      await persist(failed);
    } finally {
      if (myGen === genIdRef.current) {
        abortRef.current = null;
        setBusy(false);
        setProgress("");
      }
    }
  }

  const msgs = active?.messages || [];
  const empty = msgs.length === 0;
  const threadFiles = files.filter((f) => f.threadId === (active?.id || ""));
  const stats = snapshotStats(threads, memory, files);
  const engineLabel =
    status?.active_model ||
    status?.default_model ||
    (allowInBrowserLlm() ? "in-browser model" : "host / download zip");
  const browserLlmOff = !allowInBrowserLlm();
  const ollamaReady = !!(status?.local_llm?.backend || status?.ollama);

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
                void requireAccount(() => {
                  void downloadOnThisDevice({ manifest: buildManifest("ollama", "light") });
                })
              }
            >
              <Download size={14} /> Download zip
            </button>
            <button type="button" className="ghost" disabled={busy} onClick={() => void compact()}>
              Save summary
            </button>
            <button type="button" className="ghost" disabled={busy} onClick={() => void wipe()}>
              {wipeArmed ? "Confirm delete" : "Delete data"}
            </button>
            {profile?.email_verified ? (
              <button
                type="button"
                className="ghost"
                onClick={() => {
                  clearAccount();
                  setProfile(null);
                }}
              >
                Sign out
              </button>
            ) : (
              <button type="button" className="ghost" onClick={() => setAuthOpen(true)}>
                Sign in
              </button>
            )}
          </div>
        </header>

        <OfflineBanner stayLabel="Continue offline chat" />

        {browserLlmOff && !ollamaReady ? (
          <div className="setup-callout" role="note">
            <p className="setup-callout-title">Start local Surf</p>
            <p>
              This site is the shell only. Download the zip, run <strong>LOCAL-SETUP</strong> on your
              computer, then refresh — chat and Moss stay on your machine.
            </p>
          </div>
        ) : /1b|1\.5b|in-browser/i.test(engineLabel) ||
          (!status?.local_llm?.backend && !status?.ollama) ? (
          <div className="setup-callout soft" role="note">
            <p>
              Light model on (
              <strong>{/in-browser/i.test(engineLabel) ? "browser" : engineLabel}</strong>
              ). Download the zip for fuller answers on your computer.
            </p>
          </div>
        ) : null}

        <div ref={logRef} className="chat-log">
          <div className="mobile-only">
            <LocalEngines status={status} />
            <LocalDataCard stats={stats} origin={origin} last={last} host={hostStore} />
            <FeedbackInbox refreshKey={fbTick} />
          </div>
          {empty && (
            <div className="empty">
              {browserLlmOff && engine === "browser" && !ollamaReady ? (
                <>
                  <h1>Private AI on your computer</h1>
                  <p className="muted">
                    synap.surf is the shell. Your model, Moss, and chats run on the machine in front of
                    you — not on our servers.
                  </p>
                  <button
                    type="button"
                    className="primary empty-download"
                    onClick={() =>
                      void requireAccount(() => {
                        void downloadOnThisDevice({ manifest: buildManifest("ollama", "light") });
                      })
                    }
                  >
                    <Download size={18} />{" "}
                    {profile?.email_verified
                      ? "Download pack"
                      : "Create account to download"}
                  </button>
                  <p className="setup-empty-hint">
                    {profile?.email_verified
                      ? "Unzip → run LOCAL-SETUP → Surf opens on your computer."
                      : "Create an account first. Then download the zip, run LOCAL-SETUP, and use Surf on your computer."}
                  </p>
                </>
              ) : (
                <>
                  <h1>Ask anything</h1>
                  <p className="muted">
                    General questions work with no files. Attach documents when you want answers
                    grounded in them.
                  </p>
                  {gpu === false && engine === "browser" && allowInBrowserLlm() ? (
                    <p className="setup-empty-hint">
                      This browser cannot run the in-page model. Use Google Chrome, or download the
                      zip for your computer.
                    </p>
                  ) : null}
                </>
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
                      {m.role === "assistant" ? (
                        <MarkdownBody text={m.content} streaming={Boolean(busy && lastAssistant)} />
                      ) : (
                        m.content
                      )}
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
                    Used{" "}
                    {[
                      ...new Set(
                        turnMeta.sources
                          .map((s) => s.title)
                          .filter((t): t is string => Boolean(t && String(t).trim())),
                      ),
                    ].join(", ")}
                    {turnMeta.moss?.backend &&
                    turnMeta.moss.backend !== "skipped" &&
                    (turnMeta.moss.hits ?? 0) > 0 &&
                    turnMeta.moss.time_taken_ms
                      ? ` · Moss retrieval ${turnMeta.moss.time_taken_ms} ms`
                      : ""}
                    {turnMeta.model ? ` · ${turnMeta.model}` : ""}
                  </div>
                )}
                {m.role === "assistant" && m.content && replyTimeLabel(m) && (
                  <div className="tiny muted msg-time">{replyTimeLabel(m)}</div>
                )}
                {m.role === "assistant" && m.content && (
                  <div className="reply-tools">
                    <CopyReplyButton
                      markdown={m.content}
                      disabled={Boolean(busy && lastAssistant)}
                    />
                    <MessageFeedback
                      conversationId={active?.hostConversationId}
                      engine={engine}
                      onSent={() => setFbTick((n) => n + 1)}
                    />
                  </div>
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
            {progress && !busy && !isBrowserModelProgress(progress) ? (
              <div className="composer-status" role="status">{progress}</div>
            ) : null}
            <div className="composer-box">
              <input
                ref={fileRef}
                type="file"
                hidden
                multiple
                accept=".pdf,.docx,.xlsx,.xls,.csv,.tsv,.pptx,.txt,.md,.json,.zip,application/pdf,text/*,.py,.ts,.tsx,.js"
                onChange={(e) => {
                  if (e.target.files?.length) void addFiles(e.target.files);
                }}
              />
              <div className="attach-one">
                <button
                  type="button"
                  className="icon"
                  aria-label="Attach files or a folder"
                  title="Attach files or a folder"
                  disabled={busy}
                  onClick={() => void addFromFilesOrFolder()}
                >
                  <Paperclip size={16} />
                </button>
              </div>
              <textarea
                value={input}
                rows={1}
                placeholder={threadFiles.length ? "Ask about the attached files…" : "Message…"}
                data-gramm="false"
                data-gramm_editor="false"
                data-enable-grammarly="false"
                spellCheck
                onChange={(e) => {
                  setInput(e.target.value);
                  if (progress && !busy) setProgress("");
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    if (!busy) void send();
                  }
                }}
              />
              <button
                type="button"
                className={listening ? "icon mic-on" : "icon"}
                onClick={toggleMic}
                disabled={!dictateOk || busy}
                aria-pressed={listening}
                aria-label={listening ? "Stop dictation (recording)" : "Start dictation"}
                title={listening ? "Recording — click to stop" : "Dictate"}
              >
                <Mic size={16} />
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
        onClose={() => {
          setAuthOpen(false);
          setAuthNext(null);
        }}
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
