import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { parseDiagram, renderDiagramSvg } from "./diagrams.js";
import { renderMarkdown } from "./markdown.js";
import { slugifyHeading } from "./normalize.js";
import { buildSearchIndex } from "./search.js";
import type {
  DocsBuildResult,
  DocsCatalog,
  DocsDocument,
  DocsProjectState,
  DocsRef,
} from "./types.js";

export interface StaticRenderOptions {
  outputDir: string;
  title?: string;
  clean?: boolean;
}
export interface StaticRenderResult {
  outputDir: string;
  files: string[];
  searchIndex: string;
}

const CSS = `:root {
  color-scheme: light dark;
  --bg: #f8f9fa;
  --surface: #ffffff;
  --surface-alt: #f1f3f5;
  --text: #212529;
  --muted: #68727d;
  --border: #d9dee3;
  --accent: #4f46e5;
  --accent-strong: #3730a3;
  --accent-soft: rgba(99, 102, 241, 0.1);
  --code: #eef1f4;
  --focus: #d97706;
  --success: #15803d;
  --success-soft: #dcfce7;
  --warning: #a16207;
  --warning-soft: #fef3c7;
  --error: #b91c1c;
  --error-soft: #fee2e2;
  --radius: 12px;
  --measure: 78ch;
  --shadow: 0 12px 32px rgba(17, 24, 39, 0.08);
}
* { box-sizing: border-box; }
html { background: var(--bg); color: var(--text); font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; line-height: 1.65; overflow-wrap: anywhere; }
html, body { max-width: 100%; }
body { margin: 0; min-width: 0; overflow-x: clip; }
a { color: var(--accent-strong); text-underline-offset: .18em; }
a:hover { color: var(--accent); }
a:focus-visible, button:focus-visible, input:focus-visible, summary:focus-visible { outline: 3px solid var(--focus); outline-offset: 3px; border-radius: 4px; }
.skip-link { position: absolute; left: -9999px; }
.skip-link:focus { left: 1rem; top: 1rem; background: var(--surface); padding: .65rem 1rem; z-index: 10; }
.shell { display: grid; grid-template-columns: minmax(15rem, 20rem) minmax(0, 1fr); min-height: 100vh; }
.sidebar { padding: 1.5rem; border-right: 1px solid var(--border); background: var(--surface); position: sticky; top: 0; height: 100vh; overflow: auto; }
.sidebar strong { display: block; color: var(--accent-strong); letter-spacing: -.02em; margin-bottom: 1.25rem; }
.sidebar nav a { display: block; padding: .45rem .65rem; border-radius: 8px; text-decoration: none; }
.sidebar nav a:hover { background: var(--accent-soft); }
.main { min-width: 0; padding: clamp(1.25rem, 4vw, 4rem); }
.content { max-width: 88rem; margin-inline: auto; }
.shell, .main, .content, .card, .section-card, .state-grid, .field-list, .item-grid { min-width: 0; max-width: 100%; }
h1, h2, h3 { line-height: 1.2; letter-spacing: -.025em; }
h1 { font-size: clamp(2rem, 5vw, 3.5rem); margin-top: .35rem; }
.card-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(18rem, 100%), 1fr)); gap: 1rem; }
.card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 1.15rem; box-shadow: var(--shadow); }
.card h2, .card h3 { margin-top: 0; }
.meta { color: var(--muted); font-size: .92rem; }
.eyebrow { color: var(--accent-strong); font-size: .78rem; font-weight: 750; letter-spacing: .1em; text-transform: uppercase; }
.metric { font-size: 1.65rem; font-weight: 760; line-height: 1; }
.section-card { scroll-margin-top: 1rem; }
.section-card + .section-card { margin-top: 1.25rem; }
.section-nav { display: flex; flex-wrap: wrap; gap: .45rem; margin: 1.25rem 0; }
.section-nav a { border: 1px solid var(--border); border-radius: 999px; padding: .25rem .65rem; }
.project-header { display: flex; align-items: end; justify-content: space-between; gap: 1rem; margin-bottom: 1rem; }
.project-header h1 { margin-bottom: 0; }
.project-nav { display: flex; flex-wrap: wrap; gap: .4rem; margin: 0 0 1.25rem; padding: .55rem; position: sticky; top: 0; z-index: 5; border: 1px solid var(--border); border-radius: var(--radius); background: color-mix(in srgb, var(--surface) 94%, transparent); box-shadow: var(--shadow); backdrop-filter: blur(12px); }
.project-nav a { border-radius: 8px; padding: .45rem .7rem; text-decoration: none; white-space: nowrap; }
.project-nav a:hover { background: var(--accent-soft); }
.project-nav a[aria-current="page"] { background: var(--accent); color: #fff; font-weight: 700; }
.summary-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(11rem, 100%), 1fr)); gap: .75rem; margin: 1rem 0; }
.summary-card { min-width: 0; padding: .9rem; border: 1px solid var(--border); border-radius: 10px; background: var(--surface-alt); }
.summary-card strong { display: block; font-size: 1.5rem; line-height: 1.15; }
.summary-card span { color: var(--muted); font-size: .82rem; }
.signal-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(16rem, 100%), 1fr)); gap: 1rem; }
.section-links { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(15rem, 100%), 1fr)); gap: .9rem; }
.section-link { display: block; height: 100%; color: inherit; text-decoration: none; }
.section-link:hover { border-color: var(--accent); background: var(--accent-soft); }
.section-link h2, .section-link h3 { color: var(--accent-strong); margin-top: 0; }
.status-badge { display: inline-flex; align-items: center; width: fit-content; border: 1px solid var(--border); border-radius: 999px; padding: .12rem .55rem; font-size: .78rem; font-weight: 700; }
.status-badge[data-tone="success"] { color: var(--success); background: var(--success-soft); border-color: color-mix(in srgb, var(--success) 35%, transparent); }
.status-badge[data-tone="warning"] { color: var(--warning); background: var(--warning-soft); border-color: color-mix(in srgb, var(--warning) 35%, transparent); }
.status-badge[data-tone="error"] { color: var(--error); background: var(--error-soft); border-color: color-mix(in srgb, var(--error) 35%, transparent); }
.status-badge[data-tone="neutral"] { color: var(--muted); background: var(--surface-alt); }
.document-groups { display: grid; gap: 1rem; }
.document-card { display: grid; gap: .45rem; }
.document-card h3 { margin: 0; }
.search-controls { display: grid; grid-template-columns: minmax(14rem, 2fr) repeat(3, minmax(9rem, 1fr)); gap: .75rem; align-items: end; margin: 1rem 0; }
.control-field { display: grid; gap: .3rem; }
.control-field label { color: var(--muted); font-size: .82rem; font-weight: 700; }
.search-results { display: grid; gap: .75rem; padding: 0; list-style: none; }
.search-result { border: 1px solid var(--border); border-radius: 10px; padding: .9rem; background: var(--surface); }
.search-result a { font-weight: 750; }
.search-result p { margin: .45rem 0 0; }
.state-grid, .field-list { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(13rem, 100%), 1fr)); gap: .8rem 1rem; margin: 0; }
.field-list > div { min-width: 0; }
.field-list dt { color: var(--muted); font-size: .82rem; font-weight: 700; }
.field-list dd { margin: 0; min-width: 0; }
.item-grid { display: grid; gap: .9rem; }
.item-card { min-width: 0; border: 1px solid var(--border); border-radius: 9px; padding: .9rem; background: var(--surface-alt); }
.item-card h3, .item-card h4 { overflow-wrap: anywhere; }
.item-card h3 { margin: 0 0 .55rem; }
.item-card h4 { margin-bottom: .35rem; }
.item-card + .item-card { margin-top: .75rem; }
.empty-state { border-left: 4px solid var(--border); color: var(--muted); margin: .7rem 0; padding: .45rem .75rem; }
.empty-value { color: var(--muted); font-style: italic; }
.compact-list { margin: .35rem 0 0; padding-left: 1.25rem; }
.ref-list { display: grid; gap: .25rem; margin: .35rem 0 0; padding-left: 1.25rem; }
.flow-steps { display: grid; gap: .8rem; margin: .75rem 0 0; padding-left: 1.4rem; }
.flow-diagram { margin-block: 1rem; }
.flow-diagram figcaption { color: var(--muted); font-size: .86rem; margin-top: .65rem; text-align: center; }
.flow-details { border-top: 1px solid var(--border); margin-top: 1rem; padding-top: .75rem; }
.flow-details > summary { color: var(--accent-strong); cursor: pointer; font-weight: 750; }
.compact-list, .ref-list, .flow-steps { min-width: 0; max-width: 100%; }
.flow-steps > li { padding-left: .25rem; }
.diagnostic-list code, .item-card code { overflow-wrap: anywhere; }
.code-block, pre { overflow: auto; background: var(--code); padding: 1rem; border-radius: 8px; white-space: pre-wrap; overflow-wrap: anywhere; }
code { background: var(--code); padding: .1em .3em; border-radius: 4px; }
pre code { background: transparent; padding: 0; }
.table-scroll { max-width: 100%; overflow-x: auto; }
table { border-collapse: collapse; width: 100%; min-width: 0; table-layout: fixed; }
th, td { border: 1px solid var(--border); padding: .6rem .75rem; text-align: left; vertical-align: top; }
th { background: var(--surface-alt); }
blockquote { border-left: .25rem solid var(--accent); margin: 1rem 0; padding: .25rem 1rem; color: var(--muted); }
img { display: block; max-width: 100%; height: auto; border-radius: 8px; }
.diagram { border: 1px solid var(--border); border-radius: var(--radius); padding: 1rem; background: var(--surface); margin: 1.25rem 0; overflow: hidden; }
.diagram-svg { display: block; max-width: 100%; height: auto; margin-inline: auto; }
.diagram-node { fill: var(--accent-soft); stroke: var(--accent); stroke-width: 2; }
.diagram-edge { fill: none; stroke: var(--muted); stroke-width: 2; }
.diagram-arrow { fill: var(--muted); }
.diagram-label { fill: var(--text); font: 600 15px system-ui, sans-serif; }
.diagram-fallback { margin-top: .75rem; }
.breadcrumbs { color: var(--muted); font-size: .9rem; }
.status { display: inline-block; border: 1px solid var(--border); border-radius: 999px; padding: .1rem .55rem; }
.document-layout { display: grid; grid-template-columns: minmax(0, var(--measure)) minmax(12rem, 16rem); gap: 2rem; align-items: start; }
.outline { position: sticky; top: 1rem; }
.outline ol { padding-left: 1.25rem; }
.diagnostic-list { display: grid; gap: .75rem; padding: 0; list-style: none; }
.warning { border-left: 4px solid var(--warning); padding-left: .75rem; }
.error { border-left: 4px solid var(--error); padding-left: .75rem; }
.info { border-left: 4px solid var(--accent); padding-left: .75rem; }
input[type="search"], select { width: 100%; min-height: 2.75rem; padding: .65rem .8rem; border: 1px solid var(--border); border-radius: 8px; background: var(--surface); color: var(--text); }
@media (prefers-color-scheme: dark) {
  :root { --bg: #0a0a0f; --surface: #15151e; --surface-alt: #1d1d29; --text: #f8fafc; --muted: #a4adba; --border: #333442; --accent: #818cf8; --accent-strong: #a5b4fc; --accent-soft: rgba(129, 140, 248, .14); --code: #20212d; --focus: #fbbf24; --success-soft: rgba(21, 128, 61, .2); --warning-soft: rgba(161, 98, 7, .2); --error-soft: rgba(185, 28, 28, .2); --shadow: 0 12px 32px rgba(0, 0, 0, .28); }
}
@media (max-width: 1023px) { .document-layout { grid-template-columns: 1fr; } .outline { position: static; order: -1; } .search-controls { grid-template-columns: 1fr 1fr; } }
@media (max-width: 767px) { .shell { display: block; } .sidebar { position: static; height: auto; border-right: 0; border-bottom: 1px solid var(--border); } .sidebar nav { display: flex; flex-wrap: wrap; gap: .25rem; } .sidebar nav p { margin: 0; } .main { padding: 1rem; } .project-header { align-items: start; flex-direction: column; } .project-nav { flex-wrap: nowrap; margin-inline: -1rem; padding-inline: 1rem; top: 0; border-inline: 0; border-radius: 0; overflow-x: auto; } .search-controls { grid-template-columns: 1fr; } .flow-diagram .diagram-label { font-size: 20px; } }
@media (max-width: 360px) { .main { padding: .75rem; } .project-nav { margin-inline: -.75rem; } .card { padding: .85rem; } .state-grid, .field-list { grid-template-columns: 1fr; } th, td { padding: .45rem; word-break: break-word; } }
@media print { .sidebar, .no-print, .outline { display: none !important; } .shell, .document-layout { display: block; } .main { padding: 0; } a { color: inherit; text-decoration: none; } .card { break-inside: avoid; box-shadow: none; } }
@media (prefers-reduced-motion: reduce) { *, *::before, *::after { scroll-behavior: auto !important; transition: none !important; animation: none !important; } }
`;
const JS = `(()=>{const q=document.querySelector('[data-search]');const project=document.querySelector('[data-project-filter]');const type=document.querySelector('[data-type-filter]');const truth=document.querySelector('[data-truth-filter]');const out=document.querySelector('[data-results]');const count=document.querySelector('[data-result-count]');if(!q||!project||!type||!truth||!out)return;fetch('search-index.json').then(r=>r.json()).then(index=>{const draw=()=>{const terms=q.value.toLowerCase().trim().split(/\\s+/).filter(Boolean);const rows=index.documents.filter(d=>(!project.value||d.projectId===project.value)&&(!type.value||d.type===type.value)&&(truth.value==='all'||(truth.value==='truth'?d.sourceOfTruth:!d.sourceOfTruth))&&terms.every(t=>[d.projectTitle,d.title,d.sourcePath,d.text,...d.tags,...d.headings].join(' ').toLowerCase().includes(t)));if(count)count.textContent=rows.length+' result'+(rows.length===1?'':'s');out.innerHTML=rows.map(d=>'<li class="search-result"><a href="'+escapeHtml(safeHref(d.route))+'">'+escapeHtml(d.title)+'</a><span class="meta"> — '+escapeHtml(d.projectTitle)+' / '+escapeHtml(d.sourcePath)+(d.status?' · '+escapeHtml(d.status):'')+(d.sourceOfTruth?' · source of truth':'')+'</span><p>'+escapeHtml(d.snippet||d.text.slice(0,240))+'</p></li>').join('')||'<li class="meta">No matching documents.</li>'};[q,project,type,truth].forEach(control=>control.addEventListener('input',draw));[project,type,truth].forEach(control=>control.addEventListener('change',draw));draw()}).catch(()=>{const notice=document.createElement('li');notice.className='warning';notice.textContent='Search index unavailable; showing the complete static list.';out.prepend(notice)});function safeHref(value){if(typeof value!=='string'||!/^projects\\/(?:[A-Za-z0-9._~!$&'()*+,;=@%-]+\\/)*[A-Za-z0-9._~!$&'()*+,;=@%-]+\\.html$/.test(value))return '#';try{const decoded=decodeURIComponent(value);if(decoded.split('/').some(part=>part==='.'||part==='..'||part.includes('\\\\')||/[\\u0000-\\u001f<>"']/.test(part)))return '#'}catch{return '#'}return value}function escapeHtml(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}})();`;

const ROUTE_PATTERN =
  /^projects\/(?:[A-Za-z0-9._~!$&'()*+,;=@%-]+\/)*[A-Za-z0-9._~!$&'()*+,;=@%-]+\.html$/;

function safeRoute(route: string): string {
  if (!ROUTE_PATTERN.test(route)) return "#";
  try {
    const decoded = decodeURIComponent(route);
    if (
      decoded
        .split("/")
        .some(
          (part) =>
            part === "." ||
            part === ".." ||
            part.includes("\\") ||
            /[\u0000-\u001f<>"']/.test(part),
        )
    ) {
      return "#";
    }
  } catch {
    return "#";
  }
  return route;
}

function href(fromRoute: string, targetRoute: string): string {
  const value = relative(dirname(fromRoute), targetRoute).replace(/\\/g, "/");
  return value || "./";
}
function page(
  title: string,
  body: string,
  currentRoute = "index.html",
): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><title>${escape(title)} · Forgewright Docs Hub</title><link rel="stylesheet" href="${escape(href(currentRoute, "style.css"))}"></head><body><a class="skip-link" href="#main">Skip to content</a><div class="shell"><aside class="sidebar"><strong>Forgewright Docs Hub</strong><nav aria-label="Primary"><p><a href="${escape(href(currentRoute, "index.html"))}">All projects</a></p><p><a href="${escape(href(currentRoute, "search.html"))}">Search</a></p><p><a href="${escape(href(currentRoute, "traceability.html"))}">Traceability</a></p><p><a href="${escape(href(currentRoute, "diagnostics.html"))}">Diagnostics</a></p></nav></aside><main class="main" id="main"><div class="content">${body}</div></main></div></body></html>`;
}
function escape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
function label(value: string | null | undefined): string {
  if (!value) return "Unavailable";
  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}
function emptyState(message: string): string {
  return `<p class="empty-state">${escape(message)}</p>`;
}
function listItems<T>(
  items: T[],
  render: (item: T, index: number) => string,
  message: string,
): string {
  return items.length
    ? `<div class="item-grid">${items.map(render).join("")}</div>`
    : emptyState(message);
}
function valuesList(values: string[], message: string): string {
  return values.length
    ? `<ul class="compact-list">${values.map((value) => `<li>${escape(value)}</li>`).join("")}</ul>`
    : emptyState(message);
}
function renderRef(
  ref: DocsRef,
  catalog: DocsCatalog,
  fromRoute: string,
): string {
  const document = catalog.documents.find(
    (candidate) => candidate.sourcePath === ref.path,
  );
  const text = `${ref.path}${ref.anchor ? `#${ref.anchor}` : ""}`;
  if (!document) return `<code>${escape(text)}</code>`;
  const fragment = ref.anchor ? `#${slugifyHeading(ref.anchor)}` : "";
  return `<a href="${escape(`${href(fromRoute, document.route)}${fragment}`)}">${escape(text)}</a>`;
}
function renderRefs(
  refs: DocsRef[],
  catalog: DocsCatalog,
  fromRoute: string,
  message = "No references recorded.",
): string {
  return refs.length
    ? `<ul class="ref-list">${refs.map((ref) => `<li>${renderRef(ref, catalog, fromRoute)}</li>`).join("")}</ul>`
    : emptyState(message);
}
function fieldList(fields: Array<[string, string]>): string {
  return `<dl class="field-list">${fields.map(([name, value]) => `<div><dt>${escape(name)}</dt><dd>${value}</dd></div>`).join("")}</dl>`;
}
function stateUnavailable(): string {
  return emptyState("Project state unavailable.");
}
function stateFreshness(catalog: DocsCatalog): string {
  if (!catalog.project.state) return "Unavailable";
  if (
    catalog.diagnostics.some(
      (diagnostic) => diagnostic.code === "PROJECT_STATE_FUTURE_TIMESTAMP",
    )
  ) {
    return "Future timestamp";
  }
  return catalog.diagnostics.some(
    (diagnostic) => diagnostic.code === "PROJECT_STATE_STALE",
  )
    ? "Stale"
    : "Current";
}
function stateUpdated(catalog: DocsCatalog): string {
  return catalog.project.state?.status.updated_at ?? "Unavailable";
}
function stateSource(catalog: DocsCatalog): string {
  return catalog.project.statePath ?? "Unavailable";
}
function renderStateStatus(
  state: DocsProjectState,
  catalog: DocsCatalog,
): string {
  const status = state.status;
  return `<p>${escape(status.summary)}</p>${fieldList([
    ["Project health", escape(label(status.health))],
    ["Lifecycle", escape(label(status.lifecycle))],
    ["Phase", escape(status.phase)],
    ["State freshness", escape(stateFreshness(catalog))],
    ["Last updated", escape(status.updated_at)],
    ["Next update", escape(status.next_update_at ?? "Not scheduled")],
  ])}<h3>Blockers</h3>${listItems(
    status.blockers,
    (blocker) =>
      `<article class="item-card"><h4>${escape(blocker.title)}</h4>${fieldList([
        ["ID", `<code>${escape(blocker.id)}</code>`],
        ["Owner", escape(blocker.owner)],
      ])}</article>`,
    "No blockers recorded.",
  )}<h3>Risks</h3>${listItems(
    status.risks,
    (risk) =>
      `<article class="item-card"><h4>${escape(risk.title)}</h4>${fieldList([
        ["ID", `<code>${escape(risk.id)}</code>`],
        ["Owner", escape(risk.owner)],
        ["Mitigation", escape(risk.mitigation)],
      ])}</article>`,
    "No risks recorded.",
  )}<h3>Next actions</h3>${listItems(
    status.next_actions,
    (action) =>
      `<article class="item-card"><h4>${escape(action.title)}</h4>${fieldList([
        ["ID", `<code>${escape(action.id)}</code>`],
        ["Owner", escape(action.owner)],
        ["Due date", escape(action.due_date ?? "Not scheduled")],
      ])}</article>`,
    "No next actions recorded.",
  )}`;
}
function renderStructureSection(state: DocsProjectState): string {
  return `<section id="structure" class="card section-card"><h2>Structure</h2><h3>Roots</h3>${listItems(
    state.structure.roots,
    (root) =>
      `<article class="item-card"><h4>${escape(root.path)}</h4>${fieldList([
        ["ID", `<code>${escape(root.id)}</code>`],
        ["Kind", escape(root.kind)],
        ["Purpose", escape(root.purpose)],
        ["Owner", escape(root.owner)],
      ])}</article>`,
    "No structure roots recorded.",
  )}<h3>Dependencies</h3>${state.structure.dependencies.length ? `<ul class="compact-list">${state.structure.dependencies.map((dependency) => `<li><code>${escape(dependency.from)}</code> depends on <code>${escape(dependency.to)}</code> <span class="meta">(${escape(dependency.type)})</span></li>`).join("")}</ul>` : emptyState("No dependencies recorded.")}</section>`;
}

function renderRoadmapSection(
  state: DocsProjectState,
  catalog: DocsCatalog,
  projectRoute: string,
): string {
  return `<section id="roadmap" class="card section-card"><h2>Roadmap</h2>${listItems(
    state.roadmap,
    (item) =>
      `<article class="item-card"><h3>${escape(item.title)}</h3>${fieldList([
        ["ID", `<code>${escape(item.id)}</code>`],
        ["Status", escape(label(item.status))],
        ["Priority", escape(label(item.priority))],
        ["Owner", escape(item.owner)],
        ["Target date", escape(item.target_date ?? "Not scheduled")],
        [
          "Depends on",
          item.depends_on.length
            ? item.depends_on
                .map((dependency) => `<code>${escape(dependency)}</code>`)
                .join(", ")
            : `<span class="empty-value">None</span>`,
        ],
        ["References", renderRefs(item.references, catalog, projectRoute)],
      ])}</article>`,
    "No roadmap items recorded.",
  )}</section>`;
}

function renderFlowsSection(
  state: DocsProjectState,
  catalog: DocsCatalog,
  projectRoute: string,
): string {
  return `<section id="flows" class="card section-card"><h2>Flows</h2>${listItems(
    state.flows,
    (flow) =>
      `<article class="item-card"><h3>${escape(flow.title)}</h3>${fieldList([
        ["ID", `<code>${escape(flow.id)}</code>`],
        ["Status", escape(label(flow.status))],
        ["Trigger", escape(flow.trigger)],
      ])}${
        flow.steps.length
          ? `${renderFlowDiagram(flow)}<details class="flow-details"><summary>Step details</summary><ol class="flow-steps">${flow.steps
              .map(
                (step) =>
                  `<li><h4>${escape(step.name)}</h4>${fieldList([
                    ["ID", `<code>${escape(step.id)}</code>`],
                    ["Actor", escape(step.actor)],
                    ["Inputs", valuesList(step.inputs, "No inputs recorded.")],
                    [
                      "Outputs",
                      valuesList(step.outputs, "No outputs recorded."),
                    ],
                    [
                      "References",
                      renderRefs(step.references, catalog, projectRoute),
                    ],
                  ])}</li>`,
              )
              .join("")}</ol></details>`
          : emptyState("No ordered steps recorded.")
      }</article>`,
    "No flows recorded.",
  )}</section>`;
}

function mermaidFlowText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\[/g, "&#91;")
    .replace(/\]/g, "&#93;")
    .replace(/\(/g, "&#40;")
    .replace(/\)/g, "&#41;")
    .replace(/\{/g, "&#123;")
    .replace(/\}/g, "&#125;")
    .replace(/\s+/g, " ")
    .trim();
}

function renderFlowDiagram(flow: DocsProjectState["flows"][number]): string {
  const lines = [
    "flowchart TD",
    `  trigger["Trigger: ${mermaidFlowText(flow.trigger)}"]`,
  ];
  flow.steps.forEach((step, index) => {
    const node = `step_${index + 1}`;
    const previous = index === 0 ? "trigger" : `step_${index}`;
    lines.push(
      `  ${node}["${index + 1}. ${mermaidFlowText(step.name)} · ${mermaidFlowText(step.actor)}"]`,
      `  ${previous} --> ${node}`,
    );
  });
  const source = lines.join("\n");
  const diagram = parseDiagram(source, 0);
  const textFallback = diagram.labels.map(escape).join(" → ");
  return `<figure class="diagram flow-diagram" aria-label="Mermaid flow diagram: ${escape(flow.title)}">
${renderDiagramSvg(diagram, `${flow.title} Mermaid flowchart`)}
<figcaption>Mermaid flowchart generated from the canonical ordered steps.</figcaption>
<details class="diagram-fallback"><summary>Mermaid source and text fallback</summary><pre><code class="language-mermaid">${escape(source)}</code></pre><p>${textFallback}</p></details>
</figure>`;
}

function renderBacklogSection(
  state: DocsProjectState,
  catalog: DocsCatalog,
  projectRoute: string,
): string {
  return `<section id="backlog" class="card section-card"><h2>Backlog</h2>${listItems(
    state.backlog,
    (item) =>
      `<article class="item-card"><h3>${escape(item.title)}</h3>${fieldList([
        ["ID", `<code>${escape(item.id)}</code>`],
        ["Type", escape(label(item.type))],
        ["Status", escape(label(item.status))],
        ["Priority", escape(label(item.priority))],
        ["Owner", escape(item.owner)],
        [
          "Acceptance",
          valuesList(item.acceptance, "No acceptance criteria recorded."),
        ],
        ["References", renderRefs(item.references, catalog, projectRoute)],
      ])}</article>`,
    "No backlog items recorded.",
  )}</section>`;
}

function renderDiagnostics(catalog: DocsCatalog): string {
  const diagnostics = catalog.diagnostics
    .map(
      (diagnostic) =>
        `<li class="${diagnostic.severity}"><strong>${escape(diagnostic.severity)} · ${escape(diagnostic.code)}</strong> <span>${escape(diagnostic.projectId)}${diagnostic.path ? ` / ${escape(diagnostic.path)}` : ""}: ${escape(diagnostic.message)}</span>${diagnostic.suggestion ? `<p class="meta">Suggestion: ${escape(diagnostic.suggestion)}</p>` : ""}</li>`,
    )
    .join("");
  return `<ul class="diagnostic-list">${diagnostics || '<li class="meta">No diagnostics recorded.</li>'}</ul>`;
}

const PROJECT_SECTION_ROUTES = [
  ["Overview", "index.html"],
  ["Structure", "structure.html"],
  ["Roadmap", "roadmap.html"],
  ["Flows", "flows.html"],
  ["Backlog", "backlog.html"],
  ["Documents", "documents.html"],
  ["Health", "health.html"],
] as const;

function projectNav(
  projectId: string,
  currentRoute: string,
  currentPage: string,
): string {
  const projectRoot = `projects/${encodeURIComponent(projectId)}`;
  return `<nav class="project-nav" aria-label="Project control">${PROJECT_SECTION_ROUTES.map(
    ([title, file]) => {
      const target = `${projectRoot}/${file}`;
      const current = title === currentPage ? ' aria-current="page"' : "";
      return `<a href="${escape(href(currentRoute, target))}"${current}>${escape(title)}</a>`;
    },
  ).join("")}</nav>`;
}

function projectHeader(
  catalog: DocsCatalog,
  currentRoute: string,
  currentPage: string,
): string {
  const state = catalog.project.state;
  const health = state?.status.health ?? null;
  return `<p class="breadcrumbs"><a href="${escape(href(currentRoute, "index.html"))}">All projects</a></p><div class="project-header"><div><p class="eyebrow">Documentation scan: ${escape(label(catalog.project.scanStatus))}</p><h1>${escape(catalog.project.title)}</h1></div>${health ? `<span class="status-badge" data-tone="${health === "on_track" ? "success" : health === "unknown" ? "neutral" : "warning"}">${escape(label(health))}</span>` : ""}</div>${projectNav(catalog.project.id, currentRoute, currentPage)}`;
}

function projectSectionLink(
  title: string,
  description: string,
  count: string,
  projectRoute: string,
  file: string,
): string {
  const id =
    file === "health.html" ? "docs-health" : file.replace(/\.html$/, "");
  return `<section id="${escape(id)}" class="card section-link"><h2><a href="${escape(href(projectRoute, `${projectRoute.replace(/index\.html$/, "")}${file}`))}">${escape(title)}</a></h2><p>${escape(description)}</p><p class="meta">${escape(count)}</p></section>`;
}

function renderHealthSection(
  catalog: DocsCatalog,
  projectRoute: string,
): string {
  const facts = catalog.project.facts;
  return `<section id="docs-health" class="card section-card"><h2>Documentation health</h2><div class="card-grid"><section class="card"><h3>Documentation</h3><p><span class="metric">${catalog.documents.length}</span> documents</p><p class="meta">${catalog.assets.length} assets · ${catalog.project.truthDocuments.length} truth documents</p></section><section class="card"><h3>Git</h3><p>${facts.git.available ? escape(facts.git.branch ?? "detached") : "Unavailable"}</p><p class="meta">${facts.git.commit ? escape(facts.git.commit.slice(0, 12)) : "No commit"}${facts.git.dirty ? " · dirty" : ""}</p></section><section class="card"><h3>GitNexus</h3><p>${escape(facts.gitnexus.status)}</p><p class="meta">${facts.gitnexus.symbols ?? 0} symbols · ${facts.gitnexus.processes ?? 0} processes</p></section></div><h3>Project state source</h3>${fieldList(
    [
      ["Source path", `<code>${escape(stateSource(catalog))}</code>`],
      [
        "Content fingerprint",
        `<code>${escape(catalog.project.stateHash ?? "Unavailable")}</code>`,
      ],
      ["Last updated", escape(stateUpdated(catalog))],
      ["Freshness", escape(stateFreshness(catalog))],
    ],
  )}<h3>Diagnostics</h3>${renderDiagnostics(catalog)}<h3>Documents</h3>${renderDocumentsSection(catalog, projectRoute)}</section>`;
}

function renderDocumentsSection(
  catalog: DocsCatalog,
  fromRoute: string,
): string {
  const documents = catalog.documents
    .map(
      (document) =>
        `<article class="card document-card"><h3><a href="${escape(href(fromRoute, document.route))}">${escape(document.title)}</a></h3><p class="meta">${escape(document.sourcePath)} · ${escape(document.type)}${document.status ? ` · ${escape(document.status)}` : ""}${document.sourceOfTruth ? " · Source of truth" : ""}</p></article>`,
    )
    .join("");
  return `<div class="document-groups">${documents || '<p class="empty-state">No approved documents were found.</p>'}</div>`;
}

function renderOverview(catalog: DocsCatalog, projectRoute: string): string {
  const state = catalog.project.state;
  const overview = state
    ? `<section id="project-status" class="card section-card"><h2>Project status</h2><p>${escape(state.project.summary)}</p>${fieldList(
        [
          ["Product type", escape(label(state.project.product_type))],
          ["Declared lifecycle", escape(label(state.project.lifecycle))],
          ["State schema version", escape(String(state.schema_version))],
          ["State source", `<code>${escape(stateSource(catalog))}</code>`],
          ["State freshness", escape(stateFreshness(catalog))],
          ["Last updated", escape(stateUpdated(catalog))],
        ],
      )}${renderStateStatus(state, catalog)}</section>`
    : `<section id="project-status" class="card section-card"><h2>Project status</h2>${stateUnavailable()}${renderDiagnostics(catalog)}</section>`;
  const sections = [
    projectSectionLink(
      "Structure",
      "Roots and dependencies that shape the project.",
      `${state?.structure.roots.length ?? 0} roots · ${state?.structure.dependencies.length ?? 0} dependencies`,
      projectRoute,
      "structure.html",
    ),
    projectSectionLink(
      "Roadmap",
      "Priorities, owners, dates and dependencies.",
      `${state?.roadmap.length ?? 0} roadmap items`,
      projectRoute,
      "roadmap.html",
    ),
    projectSectionLink(
      "Flows",
      "Ordered product and operational flows.",
      `${state?.flows.length ?? 0} flows`,
      projectRoute,
      "flows.html",
    ),
    projectSectionLink(
      "Backlog",
      "Work items and acceptance criteria.",
      `${state?.backlog.length ?? 0} backlog items`,
      projectRoute,
      "backlog.html",
    ),
    projectSectionLink(
      "Documents",
      "Approved source documents for this project.",
      `${catalog.documents.length} documents`,
      projectRoute,
      "documents.html",
    ),
    projectSectionLink(
      "Health",
      "Freshness, diagnostics and repository facts.",
      `${catalog.diagnostics.length} diagnostics`,
      projectRoute,
      "health.html",
    ),
  ].join("");
  return `${overview}<div class="section-links">${sections}</div>`;
}
function containedPath(outputDir: string, child: string): string {
  const root = resolve(outputDir);
  const target = resolve(child);
  if (target !== root && !target.startsWith(`${root}${sep}`)) {
    throw new Error(`Static output path escapes output directory: ${child}`);
  }
  return target;
}
function safeDestination(outputDir: string, child: string): string {
  const root = resolve(outputDir);
  const target = containedPath(root, child);
  const segments = relative(root, target).split(sep).filter(Boolean);
  let current = root;
  for (const segment of ["", ...segments]) {
    current = segment ? join(current, segment) : current;
    try {
      if (lstatSync(current).isSymbolicLink()) {
        throw new Error(
          `Refusing docs output destination because it contains a symlink: ${current}`,
        );
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") break;
      if (error instanceof Error && error.message.startsWith("Refusing ")) {
        throw error;
      }
      throw new Error(`Unable to inspect docs output destination: ${current}`, {
        cause: error,
      });
    }
  }
  return target;
}
function documentBody(document: DocsDocument, catalogs: DocsCatalog[]): string {
  const catalog = catalogs.find(
    (item) => item.project.id === document.projectId,
  );
  const allDocuments = catalogs.flatMap((item) => item.documents);
  const links = new Map(
    (document.links ?? []).map((link) => [
      link.target,
      link.resolvedRoute ?? link.target,
    ]),
  );
  const firstHeading = document.headings[0];
  const normalizedTitle = document.title
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
  const firstHeadingMatchesTitle =
    firstHeading?.level === 1 &&
    firstHeading.text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .trim() === normalizedTitle;
  const content = firstHeadingMatchesTitle
    ? document.content.replace(/^#\s+.+?(?:\r?\n)+(?:\r?\n)?/, "")
    : document.content;
  const outlineHeadings = firstHeadingMatchesTitle
    ? document.headings.slice(1)
    : document.headings;
  const rendered = renderMarkdown(content, {
    diagrams: document.diagrams,
    links: document.links,
    resolveLink: (target) => links.get(target),
  });
  const backlinkItems = document.backlinks
    .map((id) => allDocuments.find((item) => item.id === id))
    .filter((item): item is DocsDocument => item !== undefined)
    .map(
      (item) =>
        `<li><a href="${escape(href(document.route, item.route))}">${escape(item.title)}</a></li>`,
    )
    .join("");
  const relatedItems = document.related
    .map((id) => allDocuments.find((item) => item.id === id))
    .filter((item): item is DocsDocument => item !== undefined)
    .map(
      (item) =>
        `<li><a href="${escape(href(document.route, item.route))}">${escape(item.title)}</a></li>`,
    )
    .join("");
  const outline = outlineHeadings.length
    ? `<aside class="outline card" aria-label="On this page"><h2>On this page</h2><ol>${outlineHeadings.map((heading) => `<li><a href="#${escape(heading.slug)}">${escape(heading.text)}</a></li>`).join("")}</ol></aside>`
    : "";
  const projectRoute = `projects/${encodeURIComponent(document.projectId)}/index.html`;
  return `${catalog ? projectNav(catalog.project.id, document.route, "Documents") : ""}<p class="breadcrumbs"><a href="${escape(href(document.route, projectRoute))}">${escape(catalog?.project.title ?? document.projectId)}</a> / ${escape(document.sourcePath)}</p>
<h1${firstHeadingMatchesTitle ? ` id="${escape(firstHeading.slug)}"` : ""}>${escape(document.title)}</h1>
<p class="meta">${escape(document.type)}${document.status ? ` · <span class="status">${escape(document.status)}</span>` : ""}${document.sourceOfTruth ? " · source of truth" : ""}</p>
<div class="document-layout"><article>${rendered}${backlinkItems ? `<aside class="card"><h2>Backlinks</h2><ul>${backlinkItems}</ul></aside>` : ""}${relatedItems ? `<aside class="card"><h2>Related</h2><ul>${relatedItems}</ul></aside>` : ""}</article>${outline}</div>`;
}

export function renderStaticSite(
  catalogs: DocsCatalog[],
  options: StaticRenderOptions,
): StaticRenderResult {
  const orderedCatalogs = [...catalogs].sort((left, right) =>
    left.project.id.localeCompare(right.project.id),
  );
  const outputDir = resolve(options.outputDir);
  const safeOutputDir = safeDestination(outputDir, outputDir);
  mkdirSync(safeOutputDir, { recursive: true });
  const files: string[] = [];
  const write = (path: string, content: string): void => {
    const safePath = safeDestination(outputDir, path);
    mkdirSync(dirname(safePath), { recursive: true });
    safeDestination(outputDir, safePath);
    writeFileSync(safePath, content, "utf8");
    files.push(safePath);
  };
  const ownershipMetadata = {
    schema: "forgewright-docs-hub",
    schema_version: 1,
    source_fingerprints: orderedCatalogs.map((catalog) => ({
      project_id: catalog.project.id,
      fingerprint: catalog.sourceFingerprint,
    })),
  };
  write(
    join(outputDir, ".forgewright-docs-hub"),
    `${JSON.stringify(ownershipMetadata, null, 2)}\n`,
  );
  write(join(outputDir, "style.css"), CSS);
  write(join(outputDir, "app.js"), JS);
  const projectCards = orderedCatalogs
    .map((catalog) => {
      const state = catalog.project.state;
      const stateHealth = state?.status.health ?? null;
      return `<article class="card"><p class="eyebrow">Documentation scan: ${escape(label(catalog.project.scanStatus))}</p><h2><a href="${escape(`projects/${encodeURIComponent(catalog.project.id)}/index.html`)}">${escape(catalog.project.title)}</a></h2><p><span class="metric">${catalog.documents.length}</span> documents</p>${fieldList(
        [
          ["Project health", escape(label(stateHealth))],
          [
            "Lifecycle",
            escape(state ? label(state.status.lifecycle) : "Unavailable"),
          ],
          ["Phase", escape(state?.status.phase ?? "Unavailable")],
          ["State freshness", escape(stateFreshness(catalog))],
          ["Last updated", escape(stateUpdated(catalog))],
          [
            "Documentation health",
            escape(
              `${catalog.project.health.warnings} warnings, ${catalog.project.health.errors} errors, ${catalog.project.health.info} info`,
            ),
          ],
        ],
      )}</article>`;
    })
    .join("");
  write(
    join(outputDir, "index.html"),
    page(
      options.title ?? "Projects",
      `<p class="eyebrow">Local-first knowledge</p><h1>${escape(options.title ?? "Documentation projects")}</h1><p class="meta">Static, offline-readable project documentation with privacy-safe collection and traceability.</p><div class="card-grid">${projectCards || '<p class="meta">No registered projects.</p>'}</div>`,
    ),
  );
  for (const catalog of orderedCatalogs) {
    const projectRoute = `projects/${encodeURIComponent(catalog.project.id)}/index.html`;
    const projectRoot = projectRoute.replace(/index\.html$/, "");
    const stateSections = catalog.project.state
      ? {
          structure: renderStructureSection(catalog.project.state),
          roadmap: renderRoadmapSection(
            catalog.project.state,
            catalog,
            `${projectRoot}roadmap.html`,
          ),
          flows: renderFlowsSection(
            catalog.project.state,
            catalog,
            `${projectRoot}flows.html`,
          ),
          backlog: renderBacklogSection(
            catalog.project.state,
            catalog,
            `${projectRoot}backlog.html`,
          ),
        }
      : null;
    const unavailableSections = {
      structure: `<section id="structure" class="card section-card"><h2>Structure</h2>${stateUnavailable()}</section>`,
      roadmap: `<section id="roadmap" class="card section-card"><h2>Roadmap</h2>${stateUnavailable()}</section>`,
      flows: `<section id="flows" class="card section-card"><h2>Flows</h2>${stateUnavailable()}</section>`,
      backlog: `<section id="backlog" class="card section-card"><h2>Backlog</h2>${stateUnavailable()}</section>`,
    };
    write(
      join(outputDir, projectRoute),
      page(
        catalog.project.title,
        `${projectHeader(catalog, projectRoute, "Overview")}${renderOverview(catalog, projectRoute)}`,
        projectRoute,
      ),
    );
    for (const [name, title] of [
      ["structure", "Structure"],
      ["roadmap", "Roadmap"],
      ["flows", "Flows"],
      ["backlog", "Backlog"],
    ] as const) {
      const route = `${projectRoot}${name}.html`;
      write(
        join(outputDir, route),
        page(
          `${title} · ${catalog.project.title}`,
          `${projectHeader(catalog, route, title)}${stateSections?.[name] ?? unavailableSections[name]}`,
          route,
        ),
      );
    }
    const documentsRoute = `${projectRoot}documents.html`;
    write(
      join(outputDir, documentsRoute),
      page(
        `Documents · ${catalog.project.title}`,
        `${projectHeader(catalog, documentsRoute, "Documents")}<section id="documents" class="card section-card"><h2>Documents</h2>${renderDocumentsSection(catalog, documentsRoute)}</section>`,
        documentsRoute,
      ),
    );
    const healthRoute = `${projectRoot}health.html`;
    write(
      join(outputDir, healthRoute),
      page(
        `Health · ${catalog.project.title}`,
        `${projectHeader(catalog, healthRoute, "Health")}${renderHealthSection(catalog, healthRoute)}`,
        healthRoute,
      ),
    );
    for (const document of catalog.documents) {
      write(
        join(outputDir, document.route),
        page(
          document.title,
          documentBody(document, orderedCatalogs),
          document.route,
        ),
      );
    }
    for (const asset of catalog.assets) {
      const target = safeDestination(outputDir, join(outputDir, asset.route));
      mkdirSync(dirname(target), { recursive: true });
      safeDestination(outputDir, target);
      copyFileSync(join(catalog.project.root, asset.sourcePath), target);
      files.push(target);
    }
  }
  const index = buildSearchIndex(orderedCatalogs);
  write(
    join(outputDir, "search-index.json"),
    `${JSON.stringify(index, null, 2)}\n`,
  );
  const browseFallback = orderedCatalogs
    .flatMap((catalog) =>
      catalog.documents.map(
        (document) =>
          `<li><a href="${escape(safeRoute(document.route))}">${escape(document.title)}</a> <span class="meta">— ${escape(catalog.project.title)} / ${escape(document.sourcePath)}</span></li>`,
      ),
    )
    .join("");
  const searchTypes = [
    ...new Set(
      orderedCatalogs.flatMap((catalog) =>
        catalog.documents.map((document) => document.type),
      ),
    ),
  ].sort((left, right) => left.localeCompare(right));
  const projectOptions = orderedCatalogs
    .map(
      (catalog) =>
        `<option value="${escape(catalog.project.id)}">${escape(catalog.project.title)}</option>`,
    )
    .join("");
  const typeOptions = searchTypes
    .map(
      (type) =>
        `<option value="${escape(type)}">${escape(label(type))}</option>`,
    )
    .join("");
  write(
    join(outputDir, "search.html"),
    page(
      "Search",
      `<p class="eyebrow">Offline index</p><h1>Search</h1><p class="meta">Search titles, paths, headings, tags and document text.</p><noscript><p>JavaScript is disabled. Browse the complete document list below.</p></noscript><div class="search-controls"><div class="control-field"><label for="search">Search documents</label><input id="search" data-search type="search" autocomplete="off"></div><div class="control-field"><label for="project-filter">Project</label><select id="project-filter" data-project-filter><option value="">All projects</option>${projectOptions}</select></div><div class="control-field"><label for="type-filter">Type</label><select id="type-filter" data-type-filter><option value="">All types</option>${typeOptions}</select></div><div class="control-field"><label for="truth-filter">Truth</label><select id="truth-filter" data-truth-filter><option value="all">All documents</option><option value="truth">Source of truth</option><option value="non-truth">Supporting documents</option></select></div></div><p class="meta" aria-live="polite" data-result-count>${orderedCatalogs.reduce((count, catalog) => count + catalog.documents.length, 0)} results</p><ul class="search-results" data-results>${browseFallback}</ul><script src="app.js" defer></script>`,
      "search.html",
    ),
  );
  const relations = orderedCatalogs
    .flatMap((catalog) =>
      catalog.relations.map(
        (relation) =>
          `<li><strong>${escape(relation.type)}</strong> <code>${escape(relation.from)}</code> → <code>${escape(relation.to)}</code> <span class="meta">(${escape(relation.source)})</span></li>`,
      ),
    )
    .join("");
  write(
    join(outputDir, "traceability.html"),
    page(
      "Traceability",
      `<p class="eyebrow">Relationships</p><h1>Traceability</h1><p class="meta">Document, code-reference, truth, and link relations.</p><ul>${relations || '<li class="meta">No relations found.</li>'}</ul>`,
      "traceability.html",
    ),
  );
  const diagnostics = orderedCatalogs
    .flatMap((catalog) =>
      catalog.diagnostics.map(
        (diagnostic) =>
          `<li class="${diagnostic.severity}"><strong>${escape(diagnostic.severity)} · ${escape(diagnostic.code)}</strong> <span>${escape(diagnostic.projectId)}${diagnostic.path ? ` / ${escape(diagnostic.path)}` : ""}: ${escape(diagnostic.message)}</span>${diagnostic.suggestion ? `<p class="meta">Suggestion: ${escape(diagnostic.suggestion)}</p>` : ""}</li>`,
      ),
    )
    .join("");
  write(
    join(outputDir, "diagnostics.html"),
    page(
      "Diagnostics",
      `<p class="eyebrow">Documentation health</p><h1>Diagnostics</h1><ul class="diagnostic-list">${diagnostics || '<li class="meta">No diagnostics.</li>'}</ul>`,
      "diagnostics.html",
    ),
  );
  write(
    join(outputDir, "404.html"),
    page(
      "Not found",
      '<p class="eyebrow">404</p><h1>Page not found</h1><p>The requested generated document does not exist.</p><p><a href="index.html">Return to all projects</a></p>',
      "404.html",
    ),
  );
  return {
    outputDir,
    files: [...new Set(files)].sort(),
    searchIndex: join(outputDir, "search-index.json"),
  };
}

export const buildStaticPortal = renderStaticSite;

export function buildDocsHub(
  catalogs: DocsCatalog[],
  outputDir: string,
): DocsBuildResult {
  const finalOutput = resolve(outputDir);
  const stagingOutput = `${finalOutput}.staging-${process.pid}`;
  const ownershipMarker = join(finalOutput, ".forgewright-docs-hub");
  if (existsSync(finalOutput) && !existsSync(ownershipMarker)) {
    throw new Error(
      `Refusing to replace an unowned output directory: ${finalOutput}`,
    );
  }
  rmSync(stagingOutput, { recursive: true, force: true });
  let staged: StaticRenderResult;
  try {
    staged = renderStaticSite(catalogs, { outputDir: stagingOutput });
  } catch (error) {
    rmSync(stagingOutput, { recursive: true, force: true });
    throw error;
  }
  rmSync(finalOutput, { recursive: true, force: true });
  renameSync(stagingOutput, finalOutput);
  return {
    outputDir: finalOutput,
    projects: [...catalogs]
      .sort((left, right) => left.project.id.localeCompare(right.project.id))
      .map((catalog) => ({
        id: catalog.project.id,
        title: catalog.project.title,
        documents: catalog.documents.length,
        diagnostics: catalog.diagnostics.length,
      })),
    filesWritten: staged.files.length,
  };
}
