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
import { renderMarkdown } from "./markdown.js";
import { buildSearchIndex } from "./search.js";
import type { DocsBuildResult, DocsCatalog, DocsDocument } from "./types.js";

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
  --warning: #a16207;
  --error: #b91c1c;
  --radius: 12px;
  --measure: 78ch;
  --shadow: 0 12px 32px rgba(17, 24, 39, 0.08);
}
* { box-sizing: border-box; }
html { background: var(--bg); color: var(--text); font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; line-height: 1.65; overflow-wrap: anywhere; }
body { margin: 0; min-width: 0; }
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
.content { max-width: var(--measure); margin-inline: auto; }
h1, h2, h3 { line-height: 1.2; letter-spacing: -.025em; }
h1 { font-size: clamp(2rem, 5vw, 3.5rem); margin-top: .35rem; }
.card-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(18rem, 100%), 1fr)); gap: 1rem; }
.card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 1.15rem; box-shadow: var(--shadow); }
.card h2, .card h3 { margin-top: 0; }
.meta { color: var(--muted); font-size: .92rem; }
.eyebrow { color: var(--accent-strong); font-size: .78rem; font-weight: 750; letter-spacing: .1em; text-transform: uppercase; }
.metric { font-size: 1.65rem; font-weight: 760; line-height: 1; }
.code-block, pre { overflow: auto; background: var(--code); padding: 1rem; border-radius: 8px; white-space: pre-wrap; overflow-wrap: anywhere; }
code { background: var(--code); padding: .1em .3em; border-radius: 4px; }
pre code { background: transparent; padding: 0; }
.table-scroll { max-width: 100%; overflow-x: auto; }
table { border-collapse: collapse; width: 100%; min-width: 32rem; }
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
.document-layout { display: grid; grid-template-columns: minmax(0, 1fr) minmax(12rem, 16rem); gap: 2rem; align-items: start; }
.outline { position: sticky; top: 1rem; }
.outline ol { padding-left: 1.25rem; }
.diagnostic-list { display: grid; gap: .75rem; padding: 0; list-style: none; }
.warning { border-left: 4px solid var(--warning); padding-left: .75rem; }
.error { border-left: 4px solid var(--error); padding-left: .75rem; }
.info { border-left: 4px solid var(--accent); padding-left: .75rem; }
input[type="search"] { width: min(100%, 42rem); min-height: 2.75rem; padding: .65rem .8rem; border: 1px solid var(--border); border-radius: 8px; background: var(--surface); color: var(--text); }
@media (prefers-color-scheme: dark) {
  :root { --bg: #0a0a0f; --surface: #15151e; --surface-alt: #1d1d29; --text: #f8fafc; --muted: #a4adba; --border: #333442; --accent: #818cf8; --accent-strong: #a5b4fc; --accent-soft: rgba(129, 140, 248, .14); --code: #20212d; --focus: #fbbf24; --shadow: 0 12px 32px rgba(0, 0, 0, .28); }
}
@media (max-width: 1023px) { .document-layout { grid-template-columns: 1fr; } .outline { position: static; order: -1; } }
@media (max-width: 767px) { .shell { display: block; } .sidebar { position: static; height: auto; border-right: 0; border-bottom: 1px solid var(--border); } .sidebar nav { display: flex; flex-wrap: wrap; gap: .25rem; } .sidebar nav p { margin: 0; } .main { padding: 1rem; } }
@media print { .sidebar, .no-print, .outline { display: none !important; } .shell, .document-layout { display: block; } .main { padding: 0; } a { color: inherit; text-decoration: none; } .card { break-inside: avoid; box-shadow: none; } }
@media (prefers-reduced-motion: reduce) { *, *::before, *::after { scroll-behavior: auto !important; transition: none !important; animation: none !important; } }
`;
const JS = `(()=>{const q=document.querySelector('[data-search]');const out=document.querySelector('[data-results]');if(!q||!out)return;fetch('search-index.json').then(r=>r.json()).then(index=>{const draw=()=>{const terms=q.value.toLowerCase().trim().split(/\\s+/).filter(Boolean);const rows=index.documents.filter(d=>terms.every(t=>[d.projectTitle,d.title,d.sourcePath,d.text,...d.tags,...d.headings].join(' ').toLowerCase().includes(t)));out.innerHTML=rows.map(d=>'<li><a href="'+d.route+'">'+escapeHtml(d.title)+'</a><span class="meta"> — '+escapeHtml(d.projectTitle)+' / '+escapeHtml(d.sourcePath)+'</span></li>').join('')||'<li class="meta">No matching documents.</li>'};q.addEventListener('input',draw);draw()}).catch(()=>{out.innerHTML='<li class="meta">Search index unavailable; browse the project pages.</li>'});function escapeHtml(s){return s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}})();`;

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
  return `<p class="breadcrumbs"><a href="${escape(href(document.route, projectRoute))}">${escape(catalog?.project.title ?? document.projectId)}</a> / ${escape(document.sourcePath)}</p>
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
  write(
    join(outputDir, ".forgewright-docs-hub"),
    "Generated by `forge docs build`; do not edit.\n",
  );
  write(join(outputDir, "style.css"), CSS);
  write(join(outputDir, "app.js"), JS);
  const projectCards = orderedCatalogs
    .map(
      (catalog) =>
        `<article class="card"><p class="eyebrow">${escape(catalog.project.scanStatus)}</p><h2><a href="${escape(`projects/${encodeURIComponent(catalog.project.id)}/index.html`)}">${escape(catalog.project.title)}</a></h2><p><span class="metric">${catalog.documents.length}</span> documents</p><p class="meta">${catalog.project.health.warnings} warnings · ${catalog.project.health.errors} errors</p></article>`,
    )
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
    const facts = catalog.project.facts;
    const projectBody = `<p class="breadcrumbs"><a href="${escape(href(projectRoute, "index.html"))}">All projects</a></p><p class="eyebrow">${escape(catalog.project.scanStatus)}</p><h1>${escape(catalog.project.title)}</h1><div class="card-grid"><section class="card"><h2>Documentation</h2><p><span class="metric">${catalog.documents.length}</span> documents</p><p class="meta">${catalog.assets.length} assets · ${catalog.project.truthDocuments.length} truth documents</p></section><section class="card"><h2>Git</h2><p>${facts.git.available ? escape(facts.git.branch ?? "detached") : "Unavailable"}</p><p class="meta">${facts.git.commit ? escape(facts.git.commit.slice(0, 12)) : "No commit"}${facts.git.dirty ? " · dirty" : ""}</p></section><section class="card"><h2>GitNexus</h2><p>${escape(facts.gitnexus.status)}</p><p class="meta">${facts.gitnexus.symbols ?? 0} symbols · ${facts.gitnexus.processes ?? 0} processes</p></section></div><h2>Documents</h2><div class="card-grid">${catalog.documents.map((document) => `<article class="card"><h3><a href="${escape(href(projectRoute, document.route))}">${escape(document.title)}</a></h3><p class="meta">${escape(document.sourcePath)} · ${escape(document.type)}</p></article>`).join("") || '<p class="meta">No approved documents were found.</p>'}</div>`;
    write(
      join(outputDir, projectRoute),
      page(catalog.project.title, projectBody, projectRoute),
    );
    for (const document of catalog.documents)
      write(
        join(outputDir, document.route),
        page(
          document.title,
          documentBody(document, orderedCatalogs),
          document.route,
        ),
      );
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
          `<li><a href="${escape(document.route)}">${escape(document.title)}</a> <span class="meta">— ${escape(catalog.project.title)} / ${escape(document.sourcePath)}</span></li>`,
      ),
    )
    .join("");
  write(
    join(outputDir, "search.html"),
    page(
      "Search",
      `<p class="eyebrow">Offline index</p><h1>Search</h1><noscript><p>JavaScript is disabled. Browse the complete document list below.</p></noscript><label for="search">Search documents</label><input id="search" data-search type="search" autocomplete="off"><ul data-results>${browseFallback}</ul><script src="app.js" defer></script>`,
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
