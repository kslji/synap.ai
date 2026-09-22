"use client";

import { layersFor, parseMermaid, type FlowNode } from "@/lib/mermaidFlow";

function NodeCard({ node, tone }: { node: FlowNode; tone: number }) {
  return (
    <div className={`flow-node flow-${node.kind} tone-${tone % 4}`}>
      <span>{node.label}</span>
    </div>
  );
}

export function MermaidFlow({ source }: { source: string }) {
  const graph = parseMermaid(source);
  if (!graph) {
    return (
      <pre className="md-pre">
        <code>{source.trim()}</code>
      </pre>
    );
  }
  const layers = layersFor(graph);
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const dir = graph.dir === "LR" ? "flow-lr" : "flow-tb";
  const isTb = dir === "flow-tb";
  return (
    <div className={`flow-map ${dir}`} role="img" aria-label="Diagram">
      {layers.map((layer, i) => {
        const next = layers[i + 1] || [];
        const cross =
          graph.edges.filter((e) => layer.includes(e.from) && next.includes(e.to)).length > 0
            ? graph.edges.filter((e) => layer.includes(e.from) && next.includes(e.to))
            : graph.edges.filter((e) => layer.includes(e.from)).slice(0, 3);
        const collapseHub = isTb && next.length > 0 && cross.length > 1 && !cross.some((e) => e.label);
        return (
          <div key={i} className="flow-stage">
            <div className="flow-layer">
              {layer.map((id, ni) => {
                const node = byId.get(id);
                if (!node) return null;
                return <NodeCard key={id} node={node} tone={i + ni} />;
              })}
            </div>
            {next.length > 0 && (
              <div className="flow-connectors">
                {collapseHub ? (
                  <div className="flow-arrow">
                    <span className="flow-shaft" />
                    <span className="flow-head" />
                  </div>
                ) : (
                  cross.map((edge, ei) => (
                    <div key={`${edge.from}-${edge.to}-${ei}`} className="flow-arrow">
                      <span className="flow-shaft" />
                      {edge.label ? <em>{edge.label}</em> : null}
                      <span className="flow-head" />
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
