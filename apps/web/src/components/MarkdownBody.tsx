"use client";

import type { ReactNode } from "react";
import { looksLikeMermaid } from "@/lib/mermaidFlow";
import { stripStafferLabels } from "@/lib/groundedContext";
import { MermaidFlow } from "./MermaidFlow";

function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*|https?:\/\/[^\s)]+)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const token = m[0];
    if (token.startsWith("`")) {
      out.push(<code key={i++}>{token.slice(1, -1)}</code>);
    } else if (token.startsWith("**")) {
      out.push(<strong key={i++}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith("*")) {
      out.push(<em key={i++}>{token.slice(1, -1)}</em>);
    } else {
      out.push(
        <a key={i++} href={token} target="_blank" rel="noreferrer">
          {token}
        </a>,
      );
    }
    last = m.index + token.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
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
  for (const line of lines) {
    const heading = /^(#{1,3})\s+(.+)$/.exec(line);
    const ul = /^[-*]\s+(.+)$/.exec(line);
    const ol = /^(\d+)\.\s+(.+)$/.exec(line);
    if (heading) {
      flush();
      const title = heading[2].replace(/\s+overview\s*$/i, "").trim();
      if (
        !title ||
        /^(hook|map|overview|key components|useful extras|next move|specific references|what it is|real folders(?:\/quotes)?|what they might miss|one thing to do next)$/i.test(
          title,
        )
      ) {
        continue;
      }
      const Tag = heading[1].length === 1 ? "h3" : heading[1].length === 2 ? "h4" : "h5";
      nodes.push(<Tag key={nodes.length}>{inline(title)}</Tag>);
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
      // Keep ul/ol open across blank lines so "1.\n\n1." becomes one list (1, 2, 3…),
      // not four separate lists that all show "1."
      continue;
    } else {
      flush();
      nodes.push(<p key={nodes.length}>{inline(line)}</p>);
    }
  }
  flush();
  return <>{nodes}</>;
}

export function MarkdownBody({ text }: { text: string }) {
  const chunks: ReactNode[] = [];
  const parts = stripStafferLabels(String(text || "")).split(/```/);
  parts.forEach((part, i) => {
    if (i % 2 === 1) {
      const nl = part.indexOf("\n");
      const lang = nl === -1 ? "" : part.slice(0, nl).trim();
      const code = nl === -1 ? part : part.slice(nl + 1);
      const body = code.replace(/\n$/, "");
      if (looksLikeMermaid(lang, body)) {
        chunks.push(<MermaidFlow key={i} source={body} />);
      } else {
        chunks.push(
          <pre key={i} className="md-pre">
            <code className={lang ? `lang-${lang}` : undefined}>{body}</code>
          </pre>,
        );
      }
    } else if (part.trim()) {
      chunks.push(
        <div key={i} className="md-prose">
          {prose(part)}
        </div>,
      );
    }
  });
  return <div className="md-body">{chunks}</div>;
}
