export type FlowDir = "TB" | "LR";
export type FlowNode = { id: string; label: string; kind: "box" | "round" | "diamond" };
export type FlowEdge = { from: string; to: string; label: string };
export type FlowGraph = { dir: FlowDir; nodes: FlowNode[]; edges: FlowEdge[] };

function unquote(s: string): string {
  return s
    .trim()
    .replace(/^["']|["']$/g, "")
    .replace(/<br\s*\/?>/gi, " · ")
    .replace(/\s+/g, " ");
}

const NODE = /([A-Za-z][\w-]*)(?:\[\[([^\]]+)\]\]|\[([^\]]+)\]|\(\(([^)]+)\)\)|\(([^)]+)\)|\{([^}]+)\})?/g;
const EDGE = /([A-Za-z][\w-]*)[^\n]*?(-->|---|==>|-\.->)\s*(?:\|([^|]+)\|)?\s*>?\s*([A-Za-z][\w-]*)/;

export function looksLikeMermaid(lang: string, body: string): boolean {
  const l = (lang || "").toLowerCase();
  if (l === "mermaid" || l === "flowchart" || l.startsWith("graph")) return true;
  return /^\s*(flowchart|graph)\s+(LR|RL|TB|BT|TD)\b/i.test(body);
}

export function parseMermaid(src: string): FlowGraph | null {
  const text = String(src || "").replace(/\r/g, "").trim();
  if (!text) return null;
  const first = (text.split("\n")[0] || "").trim();
  const header = /^(?:flowchart|graph)\s+(LR|RL|TB|BT|TD)\b/i.exec(first);
  if (!header && !/mermaid/i.test(first) && !/-->/.test(text)) return null;
  const dir: FlowDir = header && /LR|RL/i.test(header[1]) ? "LR" : "TB";
  const nodes = new Map<string, FlowNode>();
  const edges: FlowEdge[] = [];

  const upsert = (id: string, label?: string, kind?: FlowNode["kind"]) => {
    const clean = id.trim();
    if (!clean) return;
    const prev = nodes.get(clean);
    nodes.set(clean, {
      id: clean,
      label: label ? unquote(label) : prev?.label || clean,
      kind: kind || prev?.kind || "box",
    });
  };

  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || /^(flowchart|graph|subgraph|end|classDef|style|click|%%)/i.test(line)) continue;
    NODE.lastIndex = 0;
    let n: RegExpExecArray | null;
    while ((n = NODE.exec(line))) {
      const label = n[2] || n[3] || n[4] || n[5] || n[6];
      let kind: FlowNode["kind"] = "box";
      if (n[4] || n[5]) kind = "round";
      if (n[6]) kind = "diamond";
      upsert(n[1], label, label ? kind : undefined);
    }
    const e = EDGE.exec(line);
    if (e) {
      upsert(e[1]);
      upsert(e[4]);
      edges.push({ from: e[1], to: e[4], label: unquote(e[3] || "") });
    }
  }

  if (!nodes.size) return null;
  return { dir, nodes: [...nodes.values()], edges };
}

export function layersFor(graph: FlowGraph): string[][] {
  const ids = graph.nodes.map((n) => n.id);
  const incoming = new Map(ids.map((id) => [id, 0]));
  for (const e of graph.edges) incoming.set(e.to, (incoming.get(e.to) || 0) + 1);
  const remaining = new Set(ids);
  const layers: string[][] = [];
  while (remaining.size) {
    let ready = [...remaining].filter((id) => (incoming.get(id) || 0) === 0);
    if (!ready.length) ready = [[...remaining][0]];
    layers.push(ready);
    for (const id of ready) remaining.delete(id);
    for (const e of graph.edges) {
      if (ready.includes(e.from) && remaining.has(e.to)) {
        incoming.set(e.to, Math.max(0, (incoming.get(e.to) || 1) - 1));
      }
    }
  }
  return layers;
}
