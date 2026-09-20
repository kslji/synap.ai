"use client";

import { Check, Copy } from "lucide-react";
import { useCallback, useMemo, useState, type ReactNode } from "react";
import {
  formatCodeBody,
  highlightTokens,
  isFileRef,
  parseTableAt,
  prepareForRender,
  splitMarkdownChunks,
  type HighlightToken,
} from "@/lib/chatMarkdown";
import { looksLikeMermaid } from "@/lib/mermaidFlow";
import { stripStafferLabels } from "@/lib/groundedContext";
import { MermaidFlow } from "./MermaidFlow";

function InlineCode({ children }: { children: ReactNode }) {
  return <code className="md-inline-code">{children}</code>;
}

function FileRef({ name }: { name: string }) {
  return (
    <span className="md-file-ref" title={`File reference: ${name}`}>
      {name}
    </span>
  );
}

/** Inline: `code`, **bold**, *em*, [text](url), bare URLs, [file.ext] refs. */
function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re =
    /(\[[^\]]+\]\([^)\s]+\)|`[^`]+`|\*\*[^*]+\*\*|__[^_]+__|\*[^*]+\*|https?:\/\/[^\s)<]+|\[[^\]\n]{1,120}\.[a-z0-9]{1,12}\])/gi;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const token = m[0];
    if (token.startsWith("[") && token.includes("](")) {
      const link = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(token);
      if (link) {
        const href = link[2];
        const safe = /^(https?:|mailto:|#)/i.test(href) ? href : "#";
        out.push(
          <a key={i++} href={safe} target="_blank" rel="noreferrer noopener">
            {link[1]}
          </a>,
        );
      } else out.push(token);
    } else if (token.startsWith("`")) {
      out.push(<InlineCode key={i++}>{token.slice(1, -1)}</InlineCode>);
    } else if (token.startsWith("**") || token.startsWith("__")) {
      out.push(<strong key={i++}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith("*") && token.endsWith("*")) {
      out.push(<em key={i++}>{token.slice(1, -1)}</em>);
    } else if (/^https?:\/\//i.test(token)) {
      out.push(
        <a key={i++} href={token} target="_blank" rel="noreferrer noopener">
          {token}
        </a>,
      );
    } else if (isFileRef(token)) {
      out.push(<FileRef key={i++} name={token.slice(1, -1)} />);
    } else {
      out.push(token);
    }
    last = m.index + token.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function Highlighted({ tokens }: { tokens: HighlightToken[] }) {
  return (
    <>
      {tokens.map((t, i) =>
        t.type === "plain" ? (
          <span key={i}>{t.text}</span>
        ) : (
          <span key={i} className={`md-tok md-tok-${t.type}`}>
            {t.text}
          </span>
        ),
      )}
    </>
  );
}

function CodeBlock({ lang, code, streaming }: { lang: string; code: string; streaming?: boolean }) {
  const formatted = useMemo(() => formatCodeBody(lang, code), [lang, code]);
  const tokens = useMemo(
    () => highlightTokens(formatted.body, formatted.lang),
    [formatted.body, formatted.lang],
  );
  const [copied, setCopied] = useState(false);
  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(formatted.body);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      /* ignore */
    }
  }, [formatted.body]);
  const label = formatted.lang || "code";
  return (
    <div className={`md-code${streaming ? " md-code-streaming" : ""}`}>
      <div className="md-code-bar">
        <span className="md-code-lang">{label}</span>
        <button type="button" className="md-code-copy" onClick={() => void copy()} aria-label="Copy code">
          {copied ? <Check size={14} /> : <Copy size={14} />}
          <span>{copied ? "Copied" : "Copy"}</span>
        </button>
      </div>
      <pre className="md-pre">
        <code className={formatted.lang ? `lang-${formatted.lang}` : undefined}>
          <Highlighted tokens={tokens} />
        </code>
      </pre>
    </div>
  );
}

function MdTable({ headers, rows }: { headers: string[]; rows: string[][] }) {
  return (
    <div className="md-table-wrap">
      <table className="md-table">
        <thead>
          <tr>
            {headers.map((h, i) => (
              <th key={i}>{inline(h)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr key={ri}>
              {headers.map((_, ci) => (
                <td key={ci}>{inline(row[ci] ?? "")}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function prose(block: string): ReactNode {
  const lines = block.replace(/\r/g, "").split("\n");
  const nodes: ReactNode[] = [];
  let list: string[] | null = null;
  let listKind: "ul" | "ol" | null = null;
  const flush = () => {
    if (!list || !listKind) return;
    const items = list.map((item, idx) => <li key={idx}>{inline(item)}</li>);
    nodes.push(listKind === "ol" ? <ol key={nodes.length}>{items}</ol> : <ul key={nodes.length}>{items}</ul>);
    list = null;
    listKind = null;
  };

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const table = parseTableAt(lines, i);
    if (table) {
      flush();
      nodes.push(<MdTable key={nodes.length} headers={table.table.headers} rows={table.table.rows} />);
      i = table.end;
      continue;
    }

    const heading = /^(#{1,4})\s+(.+)$/.exec(line);
    const ul = /^[-*]\s+(.+)$/.exec(line);
    const ol = /^(\d+)\.\s+(.+)$/.exec(line);
    const quote = /^>\s?(.*)$/.exec(line);
    const hr = /^(?:---|\*\*\*|___)\s*$/.exec(line);

    if (heading) {
      flush();
      const title = heading[2].replace(/\s+overview\s*$/i, "").trim();
      if (
        title &&
        !/^(hook|map|overview|key components|useful extras|next move|specific references|what it is|real folders(?:\/quotes)?|what they might miss|one thing to do next)$/i.test(
          title,
        )
      ) {
        const depth = heading[1].length;
        const Tag = depth === 1 ? "h3" : depth === 2 ? "h4" : "h5";
        nodes.push(<Tag key={nodes.length}>{inline(title)}</Tag>);
      }
    } else if (hr) {
      flush();
      nodes.push(<hr key={nodes.length} className="md-hr" />);
    } else if (quote) {
      flush();
      const quoted: string[] = [quote[1]];
      let j = i + 1;
      while (j < lines.length) {
        const q = /^>\s?(.*)$/.exec(lines[j]);
        if (!q) break;
        quoted.push(q[1]);
        j++;
      }
      nodes.push(
        <blockquote key={nodes.length} className="md-quote">
          {quoted.map((q, qi) => (
            <p key={qi}>{inline(q)}</p>
          ))}
        </blockquote>,
      );
      i = j;
      continue;
    } else if (ul) {
      if (listKind !== "ul") flush();
      listKind = "ul";
      list = list || [];
      list.push(ul[1]);
    } else if (ol) {
      if (listKind !== "ol") flush();
      listKind = "ol";
      list = list || [];
      list.push(ol[2]);
    } else if (!line.trim()) {
      continue;
    } else {
      flush();
      // Soft-join consecutive non-empty prose lines into one paragraph (ChatGPT-like).
      const para: string[] = [line];
      let j = i + 1;
      while (j < lines.length) {
        const n = lines[j];
        if (
          !n.trim() ||
          /^(#{1,4})\s+/.test(n) ||
          /^[-*]\s+/.test(n) ||
          /^\d+\.\s+/.test(n) ||
          /^>\s?/.test(n) ||
          /^(?:---|\*\*\*|___)\s*$/.test(n) ||
          parseTableAt(lines, j)
        ) {
          break;
        }
        para.push(n);
        j++;
      }
      nodes.push(<p key={nodes.length}>{inline(para.join(" "))}</p>);
      i = j;
      continue;
    }
    i++;
  }
  flush();
  return <>{nodes}</>;
}

type Props = {
  text: string;
  /** While the model is still streaming this message. */
  streaming?: boolean;
};

/**
 * Single reply renderer for every model path (Ollama / browser / Moss-grounded).
 * Formats for display only — callers keep the raw string in storage.
 */
export function MarkdownBody({ text, streaming = false }: Props) {
  const cleaned = stripStafferLabels(String(text || ""));
  const prepared = prepareForRender(cleaned, streaming);
  const chunks = splitMarkdownChunks(prepared);

  return (
    <div className={`md-body${streaming ? " md-streaming" : ""}`}>
      {chunks.map((chunk, i) => {
        if (chunk.kind === "code") {
          if (looksLikeMermaid(chunk.lang, chunk.body)) {
            return <MermaidFlow key={i} source={chunk.body} />;
          }
          return (
            <CodeBlock key={i} lang={chunk.lang} code={chunk.body} streaming={!chunk.closed || streaming} />
          );
        }
        if (!chunk.body.trim()) return null;
        return (
          <div key={i} className="md-prose">
            {prose(chunk.body)}
          </div>
        );
      })}
    </div>
  );
}
