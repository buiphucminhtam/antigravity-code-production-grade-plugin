import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

interface CallNode {
  uid: string;
  name: string;
  filePath: string;
  calls: CallNode[];
}

interface ApiFlow {
  clientFile: string;
  apiPath: string;
  method: string;
  routeFile: string | null;
  serverCallTree: CallNode | null;
  queryParams?: string;
}

// Parse command line arguments
const args = process.argv.slice(2);
let clientDirArg = '';
let apiDirArg = '';
let repoNameArg = '';
let outputDirArg = '';

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--client' && args[i + 1]) {
    clientDirArg = args[i + 1];
  }
  if (args[i] === '--api' && args[i + 1]) {
    apiDirArg = args[i + 1];
  }
  if (args[i] === '--repo' && args[i + 1]) {
    repoNameArg = args[i + 1];
  }
  if (args[i] === '--output' && args[i + 1]) {
    outputDirArg = args[i + 1];
  }
}

// Helper: Resolve paths relative to working directory if not absolute
const resolvePath = (p: string) => (path.isAbsolute(p) ? p : path.join(process.cwd(), p));

// Auto-detection with CLI fallbacks
let clientDir = clientDirArg ? resolvePath(clientDirArg) : '';
if (!clientDir) {
  if (fs.existsSync(path.join(process.cwd(), 'multica-hub', 'src'))) {
    clientDir = path.join(process.cwd(), 'multica-hub', 'src');
  } else if (fs.existsSync(path.join(process.cwd(), 'src'))) {
    clientDir = path.join(process.cwd(), 'src');
  } else {
    clientDir = process.cwd();
  }
}

let apiDir = apiDirArg ? resolvePath(apiDirArg) : '';
if (!apiDir) {
  if (fs.existsSync(path.join(clientDir, 'app', 'api'))) {
    apiDir = path.join(clientDir, 'app', 'api');
  } else if (fs.existsSync(path.join(clientDir, 'pages', 'api'))) {
    apiDir = path.join(clientDir, 'pages', 'api');
  } else if (fs.existsSync(path.join(clientDir, 'api'))) {
    apiDir = path.join(clientDir, 'api');
  } else {
    apiDir = clientDir;
  }
}

const repoName = repoNameArg || path.basename(process.cwd());
const OUTPUT_DIR = outputDirArg ? resolvePath(outputDirArg) : path.join(process.cwd(), 'docs', 'architecture', 'flows');
const repoRoot = process.cwd();

console.log(`🔧 Cấu hình Sequence Generator:`);
console.log(`  - Client Dir: ${clientDir}`);
console.log(`  - API Dir:    ${apiDir}`);
console.log(`  - Repo Name:  ${repoName}`);
console.log(`  - Output Dir: ${OUTPUT_DIR}`);

// Ensure the output directory exists
if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

// Blocklist for noise filtering
const EXCLUDE_SYMBOLS = new Set([
  'NextResponse',
  'NextResponse.json',
  'json',
  'execSync',
  'existsSync',
  'readFileSync',
  'writeFileSync',
  'readdirSync',
  'statSync',
  'console.log',
  'console.error',
  'console.warn',
  'console.info',
  'Error',
  'setTimeout',
  'clearTimeout',
  'setInterval',
  'clearInterval',
]);

// Helper: Recursively get all source files
function getSourceFiles(dir: string, fileList: string[] = []): string[] {
  if (!fs.existsSync(dir)) return fileList;
  try {
    const files = fs.readdirSync(dir);
    for (const file of files) {
      // Skip hidden files/directories (starting with dot) to avoid scanning .git, .venv, .antigravitycli, etc.
      if (file.startsWith('.')) continue;
      
      const filePath = path.join(dir, file);
      try {
        if (!fs.existsSync(filePath)) continue;
        const stat = fs.statSync(filePath);
        if (stat.isDirectory()) {
          if (file !== 'node_modules') {
            getSourceFiles(filePath, fileList);
          }
        } else {
          if (/\.(ts|tsx|js|jsx)$/.test(file)) {
            fileList.push(filePath);
          }
        }
      } catch (err) {
        // Safe check for transient files disappearing during scan
        continue;
      }
    }
  } catch (err) {
    // Fail-safe for permission denied or folder deletion during scan
  }
  return fileList;
}

// 1. Scan all server routes in Next.js App Router format (src/app/api/**/route.ts)
function getServerRoutes(apiDir: string): Array<{ filePath: string; apiRoutePath: string; pattern: string }> {
  const allFiles = getSourceFiles(apiDir);
  const routes: Array<{ filePath: string; apiRoutePath: string; pattern: string }> = [];

  for (const file of allFiles) {
    if (path.basename(file) === 'route.ts' || path.basename(file) === 'route.js') {
      const relPath = path.relative(apiDir, path.dirname(file));
      const apiRoutePath = `/api/${relPath.replace(/\\/g, '/')}`;
      // Replace folder dynamic markers [workspaceId] or [id] with *
      const pattern = apiRoutePath.replace(/\[[^\]]+\]/g, '*');
      routes.push({
        filePath: path.relative(process.cwd(), file),
        apiRoutePath,
        pattern,
      });
    }
  }
  return routes;
}

// 2. Resolve a client API URL pattern to a server route file
function resolveRoute(
  clientPath: string,
  serverRoutes: Array<{ filePath: string; apiRoutePath: string; pattern: string }>
): string | null {
  // Normalize query strings and dynamic templates
  let cleanPath = clientPath.split('?')[0].trim();
  // Replace template variables ${id} or ${workspaceId} or :id with *
  const cleanPattern = cleanPath
    .replace(/\$\{[^}]+\}/g, '*')
    .replace(/:[a-zA-Z0-9]+/g, '*')
    .replace(/\/+/g, '/');

  // Match pattern
  for (const route of serverRoutes) {
    if (route.pattern === cleanPattern) {
      return route.filePath;
    }
  }

  // Fallback fuzzy matching (if we have route.pattern like /api/workspaces/* and cleanPattern is /api/workspaces/*)
  const patternRegex = new RegExp('^' + cleanPattern.replace(/\*/g, '[^/]+') + '$');
  for (const route of serverRoutes) {
    const routeRegexStr = '^' + route.pattern.replace(/\*/g, '[^/]+') + '$';
    if (new RegExp(routeRegexStr).test(cleanPattern) || patternRegex.test(route.pattern)) {
      return route.filePath;
    }
  }

  return null;
}

// 3. Scan a client file for fetch/axios calls and parse HTTP methods
function scanClientFile(
  filePath: string,
  serverRoutes: Array<{ filePath: string; apiRoutePath: string; pattern: string }>
): ApiFlow[] {
  const content = fs.readFileSync(filePath, 'utf-8');
  const flows: ApiFlow[] = [];

  // Match fetch literals or template strings
  const fetchRegex = /fetch\(\s*(['"`])(\/api\/[^'"`\s\+]+)\1/g;
  let match;

  while ((match = fetchRegex.exec(content)) !== null) {
    const fullApiPath = match[2];
    const parts = fullApiPath.split('?');
    const apiPath = parts[0];
    const queryParams = parts.length > 1 ? parts[1] : undefined;
    let method = 'GET';

    // Heuristic: check if there's a method option near the fetch match
    const searchArea = content.substring(match.index, match.index + 250);
    const methodMatch = /method\s*:\s*['"`](GET|POST|PUT|DELETE|PATCH)['"`]/i.exec(searchArea);
    if (methodMatch) {
      method = methodMatch[1].toUpperCase();
    }

    const routeFile = resolveRoute(apiPath, serverRoutes);
    flows.push({
      clientFile: path.relative(process.cwd(), filePath),
      apiPath,
      method,
      routeFile,
      serverCallTree: null,
      queryParams,
    });
  }

  // Match axios calls (e.g. axios.post('/api/projects'))
  const axiosRegex = /axios\.(get|post|put|delete|patch)\(\s*(['"`])(\/api\/[^'"`\s\+]+)\2/gi;
  while ((match = axiosRegex.exec(content)) !== null) {
    const method = match[1].toUpperCase();
    const fullApiPath = match[3];
    const parts = fullApiPath.split('?');
    const apiPath = parts[0];
    const queryParams = parts.length > 1 ? parts[1] : undefined;
    const routeFile = resolveRoute(apiPath, serverRoutes);
    flows.push({
      clientFile: path.relative(process.cwd(), filePath),
      apiPath,
      method,
      routeFile,
      serverCallTree: null,
      queryParams,
    });
  }

  return flows;
}

// 4. Trace the server call graph from GitNexus recursively
function traceServerCall(symbolUid: string, visited: Set<string> = new Set(), depth = 0): CallNode | null {
  if (depth > 5 || visited.has(symbolUid)) return null;
  visited.add(symbolUid);

  try {
    const command = `gitnexus context -r "${repoName}" "${symbolUid}"`;
    const output = execSync(command, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] });
    const result = JSON.parse(output);

    if (result.status !== 'found') return null;

    const symbol = result.symbol;
    const node: CallNode = {
      uid: symbol.uid,
      name: symbol.name,
      filePath: symbol.filePath,
      calls: [],
    };

    const outgoingCalls = result.outgoing?.calls || [];
    for (const call of outgoingCalls) {
      // Noise Filter: check if the call name is in the blocklist or starts with console.
      if (EXCLUDE_SYMBOLS.has(call.name) || call.name.startsWith('console.')) {
        continue;
      }

      // Filter out node_modules, libraries, standard modules, or undefined files
      if (
        call.filePath &&
        !call.filePath.includes('node_modules') &&
        !call.filePath.startsWith('node:') &&
        call.uid
      ) {
        const childNode = traceServerCall(call.uid, new Set(visited), depth + 1);
        if (childNode) {
          node.calls.push(childNode);
        }
      }
    }

    return node;
  } catch (error) {
    // If gitnexus fails, return a basic node without children
    return null;
  }
}

// Helper: Flatten a call tree for Mermaid formatting
function flattenCallTree(node: CallNode, participants: Set<string>, connections: string[]) {
  const cleanPath = node.filePath.replace(/\\/g, '/');
  participants.add(cleanPath);

  for (const child of node.calls) {
    const childPath = child.filePath.replace(/\\/g, '/');
    participants.add(childPath);
    connections.push(`${cleanPath}->>${childPath}: calls ${child.name}()`);
    flattenCallTree(child, participants, connections);
  }
}

function normalizeSlashes(value: string): string {
  return value.replace(/\\/g, '/');
}

function repoRelativePath(filePath: string): string {
  return normalizeSlashes(filePath);
}

function markdownLinkTarget(filePath: string): string {
  const absolutePath = path.resolve(repoRoot, filePath);
  const relativeFromOutput = normalizeSlashes(path.relative(OUTPUT_DIR, absolutePath));
  return relativeFromOutput.startsWith('.') ? relativeFromOutput : `./${relativeFromOutput}`;
}

// 5. Generate Mermaid diagram code and write markdown file
function generateMermaid(flow: ApiFlow) {
  const fileName = `${flow.method}-${flow.apiPath.replace(/[^a-zA-Z0-9]/g, '_')}.md`;
  const filePath = path.join(OUTPUT_DIR, fileName);

  const clientName = flow.clientFile.replace(/\\/g, '/');
  const routeName = flow.routeFile ? flow.routeFile.replace(/\\/g, '/') : 'Unknown Server Route';

  const participants = new Set<string>([clientName]);
  if (flow.routeFile) {
    participants.add(routeName);
  }

  const connections: string[] = [];
  connections.push(`${clientName}->>${routeName}: HTTP ${flow.method} ${flow.apiPath}`);

  if (flow.serverCallTree) {
    flattenCallTree(flow.serverCallTree, participants, connections);
  }

  // Convert files into participants labels
  const participantDeclarations = Array.from(participants)
    .map((p) => {
      const alias = p.replace(/[^a-zA-Z0-9]/g, '_');
      const label = path.basename(p);
      return `    participant ${alias} as "${label} (${p})"`;
    })
    .join('\n');

  // Inject query params note if present
  let noteLine = '';
  if (flow.queryParams) {
    const clientAlias = clientName.replace(/[^a-zA-Z0-9]/g, '_');
    const routeAlias = routeName.replace(/[^a-zA-Z0-9]/g, '_');
    noteLine = `    Note over ${clientAlias},${routeAlias}: Query Parameters: ${flow.queryParams}\n`;
  }

  const connectionLines = connections
    .map((conn) => {
      const parts = conn.split(':');
      const arrowParts = parts[0].split('->>');
      const fromAlias = arrowParts[0].trim().replace(/[^a-zA-Z0-9]/g, '_');
      const toAlias = arrowParts[1].trim().replace(/[^a-zA-Z0-9]/g, '_');
      return `    ${fromAlias}->>${toAlias}:${parts[1]}`;
    })
    .join('\n');

  const markdown = `# API Flow: ${flow.method} ${flow.apiPath}
Generated: ${new Date().toISOString()}

## Flow Diagram

\`\`\`mermaid
sequenceDiagram
    autonumber
${participantDeclarations}

${noteLine}${connectionLines}
\`\`\`

## Flow Details
*   **Client Component**: [${repoRelativePath(flow.clientFile)}](${markdownLinkTarget(flow.clientFile)})
*   **API Endpoint**: \`${flow.method} ${flow.apiPath}\`
${flow.queryParams ? `*   **Query Parameters**: \`${flow.queryParams}\`\n` : ''}*   **Server Handler File**: ${
    flow.routeFile
      ? `[${repoRelativePath(flow.routeFile)}](${markdownLinkTarget(flow.routeFile)})`
      : '*Not Found*'
  }
`;

  fs.writeFileSync(filePath, markdown, 'utf-8');
  console.log(`✓ Sơ đồ luồng đã ghi ra: ${filePath}`);
}

// Main execution loop
function main() {
  const startTime = Date.now();
  console.log('🔮 Bắt đầu quét Client - Server API Flows...');

  if (!fs.existsSync(clientDir)) {
    console.error(`❌ Thư mục client không tồn tại: ${clientDir}`);
    process.exit(1);
  }

  // 1. Load all server API routes
  const serverRoutes = getServerRoutes(apiDir);
  console.log(`  Tìm thấy ${serverRoutes.length} route endpoints trên Server.`);

  // 2. Scan client files for API calls
  const allClientFiles = getSourceFiles(clientDir).filter((file) => !file.includes(path.sep + 'api' + path.sep));
  const flows: ApiFlow[] = [];

  for (const file of allClientFiles) {
    const fileFlows = scanClientFile(file, serverRoutes);
    flows.push(...fileFlows);
  }

  console.log(`  Tìm thấy ${flows.length} lượt gọi API ở Client.`);

  // 3. Trace Server call graphs for each flow
  for (const flow of flows) {
    if (flow.routeFile) {
      const symbolUid = `Function:${flow.routeFile.replace(/\\/g, '/')}:${flow.method}`;
      console.log(`  Tracing server call graph cho: ${symbolUid}`);
      flow.serverCallTree = traceServerCall(symbolUid);
    }
  }

  // 4. Generate diagrams
  for (const flow of flows) {
    generateMermaid(flow);
  }

  const executionTimeMs = Date.now() - startTime;
  const executionTimeSec = (executionTimeMs / 1000).toFixed(2);

  // 5. Generate README index file
  const readmePath = path.join(OUTPUT_DIR, 'README.md');
  const readmeContent = `# Sequence Flow Charts

Bộ tài liệu tự động vẽ sơ đồ trình tự liên thông giữa Client và Server của dự án.

## Danh sách luồng xử lý API

| HTTP Method | API Path | Client Component | Server Handler | Diagram |
| :--- | :--- | :--- | :--- | :--- |
${flows
  .map((flow) => {
    const diagramFile = `${flow.method}-${flow.apiPath.replace(/[^a-zA-Z0-9]/g, '_')}.md`;
    return `| **${flow.method}** | \`${flow.apiPath}\` | [\`${path.basename(flow.clientFile)}\`](${markdownLinkTarget(
      flow.clientFile,
    )}) | ${
      flow.routeFile
        ? `[\`${path.basename(flow.routeFile)}\`](${markdownLinkTarget(flow.routeFile)})`
        : '*Chưa xác định*'
    } | [Xem sơ đồ](${diagramFile}) |`;
  })
  .join('\n')}

---
*Generated by Forgewright Sequence Diagram Generator.*
`;

  fs.writeFileSync(readmePath, readmeContent, 'utf-8');
  console.log(`✓ Sơ đồ danh sách đã ghi ra: ${readmePath}`);
  console.log(`⏱ Thời gian thực thi: ${executionTimeSec}s`);
  console.log('🎉 Hoàn thành xuất sắc!');
}

main();
