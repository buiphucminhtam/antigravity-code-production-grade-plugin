import fs from 'fs';
import { dirname, join, basename, relative, isAbsolute, sep } from 'path';
import { fileURLToPath } from 'url';
import * as jsyaml from 'js-yaml';
import { z } from 'zod';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Build → parsers → build → mcp → FORGEWRIGHT_ROOT
const MCP_DIR = __dirname; // FORGEWRIGHT/mcp/build/parsers
const MCP_BUILD_DIR = dirname(MCP_DIR); // FORGEWRIGHT/mcp/build
const MCP_ROOT_DIR = dirname(MCP_BUILD_DIR); // FORGEWRIGHT/mcp
const FORGEWRIGHT_ROOT = dirname(MCP_ROOT_DIR); // FORGEWRIGHT

let resolvedRoot: string;
try {
  resolvedRoot = fs.realpathSync(FORGEWRIGHT_ROOT);
} catch {
  resolvedRoot = FORGEWRIGHT_ROOT;
}

export let SKILLS_DIR = join(resolvedRoot, 'skills');

export function _setRootOverride(root: string): void {
  resolvedRoot = root;
  SKILLS_DIR = join(resolvedRoot, 'skills');
}

export const FrontmatterSchema = z.object({
  name: z.string().optional(),
  description: z.string().optional(),
  version: z.string().optional(),
  tags: z.array(z.string()).optional(),
});

export interface Skill {
  name: string;
  description: string;
  version?: string;
  tags?: string[];
  filePath: string;
  content: string;
}

export interface SharedProtocol {
  name: string;
  description: string;
  uri: string;
  content: string;
}

function parseFrontmatter(content: string): { data: Partial<Skill>; body: string } {
  const frontmatterRegex = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;
  const match = content.match(frontmatterRegex);

  if (!match) {
    return { data: {}, body: content };
  }

  const [, yamlString, body] = match;
  try {
    const data = jsyaml.load(yamlString) as Partial<Skill>;
    return { data, body };
  } catch (e) {
    console.error('Failed to parse YAML frontmatter:', e);
    return { data: {}, body: content };
  }
}

function isWithinRoot(root: string, candidate: string): boolean {
  const relativePath = relative(root, candidate);
  return (
    relativePath === '' ||
    (!relativePath.startsWith(`..${sep}`) && relativePath !== '..' && !isAbsolute(relativePath))
  );
}

function resolveContainedPath(filePath: string, root: string): string | null {
  try {
    const realPath = fs.realpathSync(filePath);
    return isWithinRoot(root, realPath) ? realPath : null;
  } catch {
    return null;
  }
}

function findAllSkillFiles(dir: string, root: string, fileList: string[] = []): string[] {
  let files: fs.Dirent[];
  try {
    files = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return fileList;
  }

  for (const file of files) {
    const filePath = join(dir, file.name);
    let stats: fs.Stats;
    try {
      stats = fs.lstatSync(filePath);
    } catch {
      continue;
    }

    if (stats.isSymbolicLink()) continue;

    if (stats.isDirectory()) {
      findAllSkillFiles(filePath, root, fileList);
    } else if (file.name === 'SKILL.md') {
      const realPath = resolveContainedPath(filePath, root);
      if (realPath) fileList.push(realPath);
    }
  }
  return fileList;
}

function resolveSkillsRoot(): string | null {
  try {
    const expectedRootStats = fs.lstatSync(resolvedRoot);
    if (expectedRootStats.isSymbolicLink()) return null;

    const expectedRoot = fs.realpathSync(resolvedRoot);
    const rootStats = fs.lstatSync(SKILLS_DIR);
    if (rootStats.isSymbolicLink() || !rootStats.isDirectory()) return null;

    const realPath = fs.realpathSync(SKILLS_DIR);
    return isWithinRoot(expectedRoot, realPath) ? realPath : null;
  } catch {
    return null;
  }
}

export function getAllSkills(): Skill[] {
  const skillsRoot = resolveSkillsRoot();
  if (!skillsRoot) {
    console.error(`[Forgewright Global MCP] Skills directory not found: ${SKILLS_DIR}`);
    return [];
  }

  const skillFiles = findAllSkillFiles(skillsRoot, skillsRoot);
  const skills: Skill[] = [];

  for (const filePath of skillFiles) {
    if (filePath.includes('_shared/protocols')) continue;

    try {
      if (fs.lstatSync(filePath).isSymbolicLink()) continue;
      const safeFilePath = resolveContainedPath(filePath, skillsRoot);
      if (!safeFilePath) continue;

      const content = fs.readFileSync(safeFilePath, 'utf-8');
      const { data } = parseFrontmatter(content);

      const folderName = basename(dirname(safeFilePath));
      const name = data.name || folderName;
      const description = data.description || `Forgewright Skill: ${name}`;

      skills.push({
        name,
        description,
        version: data.version,
        tags: data.tags,
        filePath: safeFilePath,
        content,
      });
    } catch (e) {
      console.error(`[Forgewright Global MCP] Failed to read skill: ${filePath}`, e);
    }
  }

  return skills;
}

export function getSharedProtocols(): SharedProtocol[] {
  const skillsRoot = resolveSkillsRoot();
  if (!skillsRoot) return [];

  const protocolsPath = join(skillsRoot, '_shared', 'protocols');
  const protocolsDir = resolveContainedPath(protocolsPath, skillsRoot);
  if (!protocolsDir) return [];

  try {
    if (fs.lstatSync(protocolsPath).isSymbolicLink()) return [];
  } catch {
    return [];
  }

  const files = fs.readdirSync(protocolsDir).filter((f) => f.endsWith('.md'));
  const protocols: SharedProtocol[] = [];

  for (const file of files) {
    const filePath = join(protocolsDir, file);
    try {
      if (fs.lstatSync(filePath).isSymbolicLink()) continue;
      const safeFilePath = resolveContainedPath(filePath, skillsRoot);
      if (!safeFilePath) continue;

      const content = fs.readFileSync(safeFilePath, 'utf-8');
      const protocolId = file.replace('.md', '');

      protocols.push({
        name: `protocol-${protocolId}`,
        description: `Forgewright Shared Protocol: ${protocolId}`,
        uri: `fw://protocols/${protocolId}`,
        content,
      });
    } catch (e) {
      console.error(`[Forgewright Global MCP] Failed to read protocol: ${filePath}`, e);
    }
  }

  return protocols;
}
