import type { DocsDiagram, DocsHeading, DocsLink } from "./types.js";
import { renderDiagramSvg } from "./diagrams.js";

export interface MarkdownRenderOptions {
  links?: DocsLink[];
  diagrams?: DocsDiagram[];
  resolveLink?: (target: string, link?: DocsLink) => string | undefined;
}

export interface MarkdownRenderResult {
  html: string;
  headings: DocsHeading[];
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function safeUrl(value: string): string | null {
  const target = value.trim();
  if (!target || /^(?:javascript|vbscript|file|data):/i.test(target))
    return null;
  if (/^(?:https?:|mailto:|tel:|#)/i.test(target)) return target;
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(target)) return null;
  return target;
}

function inline(value: string, options: MarkdownRenderOptions): string {
  const tokens: string[] = [];
  const stash = (html: string): string => {
    const marker = `\u0000${tokens.length}\u0000`;
    tokens.push(html);
    return marker;
  };
  let text = value.replace(/`([^`\n]+)`/g, (_, code: string) =>
    stash(`<code>${escapeHtml(code)}</code>`),
  );
  text = text.replace(
    /!\[([^\]]*)\]\((?:<([^>]+)>|([^\s)]+))(?:\s+["']([^"']*)["'])?\)/g,
    (_, alt: string, wrapped: string, raw: string, title: string) => {
      const target = wrapped ?? raw;
      const url = safeUrl(options.resolveLink?.(target) ?? target);
      if (!url) return escapeHtml(alt);
      const titleAttr = title ? ` title="${escapeHtml(title)}"` : "";
      return stash(
        `<img src="${escapeHtml(url)}" alt="${escapeHtml(alt)}"${titleAttr} loading="lazy">`,
      );
    },
  );
  text = text.replace(
    /\[([^\]]+)\]\((?:<([^>]+)>|([^\s)]+))(?:\s+["']([^"']*)["'])?\)/g,
    (_, label: string, wrapped: string, raw: string, title: string) => {
      const target = wrapped ?? raw;
      const url = safeUrl(options.resolveLink?.(target) ?? target);
      if (!url) return escapeHtml(label);
      const titleAttr = title ? ` title="${escapeHtml(title)}"` : "";
      const external = /^(?:https?:|mailto:|tel:)/i.test(url)
        ? ` rel="noreferrer"${/^https?:/i.test(url) ? ` target="_blank"` : ""}`
        : "";
      return stash(
        `<a href="${escapeHtml(url)}"${titleAttr}${external}>${inline(label, options)}</a>`,
      );
    },
  );
  text = escapeHtml(text)
    .replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>")
    .replace(/__([^_\n]+)__/g, "<strong>$1</strong>")
    .replace(/\*([^*\n]+)\*/g, "<em>$1</em>")
    .replace(/_([^_\n]+)_/g, "<em>$1</em>")
    .replace(/~~([^~\n]+)~~/g, "<del>$1</del>");
  return text.replace(
    /\u0000(\d+)\u0000/g,
    (_, index: string) => tokens[Number(index)] ?? "",
  );
}

function slug(value: string): string {
  return (
    value
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "section"
  );
}

function isTableSeparator(line: string): boolean {
  const cells = line
    .trim()
    .replace(/^\||\|$/g, "")
    .split("|");
  return (
    cells.length > 0 && cells.every((cell) => /^\s*:?-{3,}:?\s*$/.test(cell))
  );
}

function tableRow(line: string, options: MarkdownRenderOptions): string[] {
  return line
    .trim()
    .replace(/^\||\|$/g, "")
    .split("|")
    .map((cell) => inline(cell.trim(), options));
}

export function renderMarkdownDocument(
  markdown: string,
  options: MarkdownRenderOptions = {},
): MarkdownRenderResult {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const output: string[] = [];
  const headings: DocsHeading[] = [];
  let index = 0;
  let paragraph: string[] = [];
  let listType: "ul" | "ol" | null = null;
  let inFence = false;
  let fenceLanguage = "";
  let fenceLines: string[] = [];
  let tableHeader: string[] | null = null;
  let diagramIndex = 0;
  const flushParagraph = (): void => {
    if (paragraph.length) {
      output.push(`<p>${inline(paragraph.join(" ").trim(), options)}</p>`);
      paragraph = [];
    }
  };
  const closeList = (): void => {
    if (listType) output.push(`</${listType}>`);
    listType = null;
  };
  while (index < lines.length) {
    const line = lines[index];
    const trimmed = line.trim();
    if (inFence) {
      if (/^```/.test(trimmed)) {
        const source = fenceLines.join("\n");
        if (fenceLanguage.toLowerCase() === "mermaid") {
          const diagram = options.diagrams?.[diagramIndex];
          diagramIndex += 1;
          output.push(renderDiagram(diagram, source));
        } else {
          const code = escapeHtml(source);
          output.push(
            `<pre class="code-block"><code class="language-${escapeHtml(fenceLanguage || "text")}">${code}</code></pre>`,
          );
        }
        inFence = false;
        fenceLines = [];
      } else fenceLines.push(line);
      index += 1;
      continue;
    }
    const fence = trimmed.match(/^```\s*([\w-]*)\s*$/);
    if (fence) {
      flushParagraph();
      closeList();
      inFence = true;
      fenceLanguage = fence[1] ?? "";
      index += 1;
      continue;
    }
    const heading = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (heading) {
      flushParagraph();
      closeList();
      const text = heading[2].replace(/[`*_~]/g, "").trim();
      const base = slug(text);
      const same = headings.filter((item) => item.slug === base).length;
      const headingSlug = same ? `${base}-${same}` : base;
      headings.push({
        level: heading[1].length,
        text,
        slug: headingSlug,
        line: index + 1,
      });
      output.push(
        `<h${heading[1].length} id="${escapeHtml(headingSlug)}">${inline(text, options)}</h${heading[1].length}>`,
      );
      index += 1;
      continue;
    }
    if (/^\s*>/.test(line)) {
      flushParagraph();
      closeList();
      const quote: string[] = [];
      while (index < lines.length && /^\s*>/.test(lines[index])) {
        quote.push(lines[index].replace(/^\s*>\s?/, ""));
        index += 1;
      }
      output.push(
        `<blockquote>${inline(quote.join(" "), options)}</blockquote>`,
      );
      continue;
    }
    if (/^\s*(?:[-+*]|\d+[.)])\s+/.test(line)) {
      flushParagraph();
      const match = line.match(/^\s*(?:([-+*])|(\d+)[.)])\s+(.+)$/);
      if (!match) {
        index += 1;
        continue;
      }
      const type: "ul" | "ol" = match[2] ? "ol" : "ul";
      if (listType !== type) {
        closeList();
        listType = type;
        output.push(`<${type}>`);
      }
      output.push(`<li>${inline(match[3], options)}</li>`);
      index += 1;
      continue;
    }
    if (
      line.includes("|") &&
      index + 1 < lines.length &&
      isTableSeparator(lines[index + 1])
    ) {
      flushParagraph();
      closeList();
      tableHeader = tableRow(line, options);
      output.push(
        `<div class="table-scroll"><table><thead><tr>${tableHeader
          .map((cell) => `<th scope="col">${cell}</th>`)
          .join("")}</tr></thead><tbody>`,
      );
      index += 2;
      continue;
    }
    if (tableHeader && line.includes("|")) {
      output.push(
        `<tr>${tableRow(line, options)
          .map((cell) => `<td>${cell}</td>`)
          .join("")}</tr>`,
      );
      index += 1;
      continue;
    }
    if (tableHeader && !trimmed) {
      output.push("</tbody></table>");
      tableHeader = null;
      index += 1;
      continue;
    }
    if (!trimmed) {
      flushParagraph();
      closeList();
      if (output.at(-1) === "</tbody></table>") output.pop();
      index += 1;
      continue;
    }
    if (/^([-*_])(?:\s*\1){2,}\s*$/.test(trimmed)) {
      flushParagraph();
      closeList();
      output.push("<hr>");
      index += 1;
      continue;
    }
    paragraph.push(trimmed);
    index += 1;
  }
  if (inFence)
    output.push(
      `<pre class="code-block"><code>${escapeHtml(fenceLines.join("\n"))}</code></pre>`,
    );
  flushParagraph();
  closeList();
  if (tableHeader) output.push("</tbody></table>");
  return { html: output.join("\n"), headings };
}

function renderDiagram(
  diagram: DocsDiagram | undefined,
  source: string,
): string {
  const valid = diagram?.valid === true;
  const label = valid ? "Mermaid diagram" : "Invalid Mermaid diagram";
  const svg = valid ? renderDiagramSvg(diagram, diagram.type) : "";
  const fallbackLabels =
    diagram?.labels && diagram.labels.length > 0
      ? `<p>${escapeHtml(diagram.labels.join(" → "))}</p>`
      : "";
  return `<figure class="diagram" aria-label="${label}">
${svg}
<details class="diagram-fallback"${valid ? "" : " open"}>
<summary>Diagram source and text fallback</summary>
<pre><code class="language-mermaid">${escapeHtml(source)}</code></pre>
${fallbackLabels}
</details>
</figure>`;
}

export function renderMarkdown(
  markdown: string,
  options: MarkdownRenderOptions = {},
): string {
  return renderMarkdownDocument(markdown, options).html;
}
