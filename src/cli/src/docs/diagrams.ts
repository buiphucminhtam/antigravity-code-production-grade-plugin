import { createHash } from "node:crypto";
import type { DocsDiagram } from "./types.js";

const SUPPORTED_DIAGRAMS = new Set([
  "flowchart",
  "graph",
  "sequencediagram",
  "classdiagram",
  "statediagram-v2",
  "erdiagram",
  "journey",
  "gantt",
  "pie",
]);

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function extractDiagramLabels(source: string): string[] {
  const labels: string[] = [];
  const seen = new Set<string>();
  const quoted = source.matchAll(/["']([^"'\n]{1,100})["']/g);
  for (const match of quoted) {
    const label = match[1].trim();
    if (label && !seen.has(label)) {
      labels.push(label);
      seen.add(label);
    }
  }

  if (labels.length === 0) {
    for (const line of source.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (
        !trimmed ||
        /^(?:flowchart|graph|sequenceDiagram|classDiagram|stateDiagram-v2|erDiagram|journey|gantt|pie)\b/i.test(
          trimmed,
        )
      ) {
        continue;
      }
      const parts = trimmed.split(/-->|---|==>|->>|-->>|:/);
      for (const part of parts) {
        const label = part
          .replace(/^[A-Za-z0-9_-]+\s*[\[(\{]+/, "")
          .replace(/[\])\}]+$/, "")
          .trim();
        if (label && label.length <= 100 && !seen.has(label)) {
          labels.push(label);
          seen.add(label);
        }
      }
    }
  }
  return labels.slice(0, 12);
}

export function parseDiagram(source: string, line: number): DocsDiagram {
  const trimmed = source.trim();
  const first = trimmed.split(/\s+/)[0]?.toLowerCase() ?? "";
  const labels = extractDiagramLabels(trimmed);
  let error: string | undefined;

  if (!trimmed) {
    error = "Diagram source is empty.";
  } else if (!SUPPORTED_DIAGRAMS.has(first)) {
    error = `Unsupported Mermaid diagram type: ${first || "<missing>"}.`;
  } else {
    const pairs: Array<[string, string]> = [
      ["[", "]"],
      ["(", ")"],
      ["{", "}"],
    ];
    for (const [open, close] of pairs) {
      const opens = [...trimmed].filter((char) => char === open).length;
      const closes = [...trimmed].filter((char) => char === close).length;
      if (opens !== closes) {
        error = `Unbalanced "${open}${close}" delimiters.`;
        break;
      }
    }
  }

  return {
    id: createHash("sha256")
      .update(`${line}:${trimmed}`)
      .digest("hex")
      .slice(0, 16),
    type: first || "unknown",
    source: trimmed,
    line,
    valid: error === undefined,
    ...(error ? { error } : {}),
    labels,
  };
}

export function renderDiagramSvg(diagram: DocsDiagram, title: string): string {
  const labels =
    diagram.labels.length > 0
      ? diagram.labels
      : [diagram.valid ? "Diagram" : "Invalid diagram"];
  const width = 760;
  const nodeWidth = 220;
  const nodeHeight = 54;
  const gap = 34;
  const height = Math.max(
    130,
    54 + labels.length * nodeHeight + Math.max(0, labels.length - 1) * gap,
  );
  const x = (width - nodeWidth) / 2;
  const nodes = labels
    .map((label, index) => {
      const y = 38 + index * (nodeHeight + gap);
      const arrow =
        index === labels.length - 1
          ? ""
          : `<path d="M ${width / 2} ${y + nodeHeight} V ${y + nodeHeight + gap - 8}" class="diagram-edge" marker-end="url(#arrow-${diagram.id})"/>`;
      return `<g>
  <rect x="${x}" y="${y}" width="${nodeWidth}" height="${nodeHeight}" rx="12" class="diagram-node"/>
  <text x="${width / 2}" y="${y + 33}" text-anchor="middle" class="diagram-label">${escapeXml(label.slice(0, 42))}</text>
  ${arrow}
</g>`;
    })
    .join("\n");

  return `<svg class="diagram-svg" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="diagram-title-${diagram.id} diagram-desc-${diagram.id}" xmlns="http://www.w3.org/2000/svg">
  <title id="diagram-title-${diagram.id}">${escapeXml(title)}</title>
  <desc id="diagram-desc-${diagram.id}">${escapeXml(labels.join(" to "))}</desc>
  <defs>
    <marker id="arrow-${diagram.id}" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
      <path d="M 0 0 L 10 5 L 0 10 z" class="diagram-arrow"/>
    </marker>
  </defs>
  ${nodes}
</svg>`;
}
