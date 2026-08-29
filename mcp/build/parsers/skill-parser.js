import fs from 'fs';
import { createHash } from 'node:crypto';
import { dirname, join, basename, relative, isAbsolute, sep } from 'path';
import { fileURLToPath } from 'url';
import { z } from 'zod';
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// Build → parsers → build → mcp → FORGEWRIGHT_ROOT
const MCP_DIR = __dirname; // FORGEWRIGHT/mcp/build/parsers
const MCP_BUILD_DIR = dirname(MCP_DIR); // FORGEWRIGHT/mcp/build
const MCP_ROOT_DIR = dirname(MCP_BUILD_DIR); // FORGEWRIGHT/mcp
const FORGEWRIGHT_ROOT = dirname(MCP_ROOT_DIR); // FORGEWRIGHT
let resolvedRoot;
try {
    resolvedRoot = fs.realpathSync(FORGEWRIGHT_ROOT);
}
catch {
    resolvedRoot = FORGEWRIGHT_ROOT;
}
export let SKILLS_DIR = join(resolvedRoot, 'skills');
export function _setRootOverride(root) {
    resolvedRoot = root;
    SKILLS_DIR = join(resolvedRoot, 'skills');
}
export const FrontmatterSchema = z.object({
    name: z.string().optional(),
    description: z.string().optional(),
    version: z.string().optional(),
    tags: z.array(z.string()).optional(),
});
export class SkillOverlayError extends Error {
    code;
    constructor(code) {
        super(code);
        this.code = code;
        this.name = 'SkillOverlayError';
    }
}
const OVERLAY_MAX_BYTES = 48 * 1024;
const OVERLAY_MAX_TOKENS = 12_000;
const SKILL_NAME = /^[a-z0-9][a-z0-9-]{0,63}$/;
function isWithinRoot(root, candidate) {
    const relativePath = relative(root, candidate);
    return (relativePath === '' ||
        (!relativePath.startsWith(`..${sep}`) && relativePath !== '..' && !isAbsolute(relativePath)));
}
function resolveContainedPath(filePath, root) {
    try {
        const realPath = fs.realpathSync(filePath);
        return isWithinRoot(root, realPath) ? realPath : null;
    }
    catch {
        return null;
    }
}
function findAllSkillFiles(dir, root, fileList = []) {
    let files;
    try {
        files = fs.readdirSync(dir, { withFileTypes: true });
    }
    catch {
        return fileList;
    }
    for (const file of files) {
        const filePath = join(dir, file.name);
        let stats;
        try {
            stats = fs.lstatSync(filePath);
        }
        catch {
            continue;
        }
        if (stats.isSymbolicLink())
            continue;
        if (stats.isDirectory()) {
            findAllSkillFiles(filePath, root, fileList);
        }
        else if (file.name === 'SKILL.md') {
            const realPath = resolveContainedPath(filePath, root);
            if (realPath)
                fileList.push(realPath);
        }
    }
    return fileList;
}
function resolveSkillsRoot() {
    try {
        const expectedRootStats = fs.lstatSync(resolvedRoot);
        if (expectedRootStats.isSymbolicLink())
            return null;
        const expectedRoot = fs.realpathSync(resolvedRoot);
        const rootStats = fs.lstatSync(SKILLS_DIR);
        if (rootStats.isSymbolicLink() || !rootStats.isDirectory())
            return null;
        const realPath = fs.realpathSync(SKILLS_DIR);
        return isWithinRoot(expectedRoot, realPath) ? realPath : null;
    }
    catch {
        return null;
    }
}
export function getAllSkills() {
    const skillsRoot = resolveSkillsRoot();
    if (!skillsRoot) {
        console.error(`[Forgewright Global MCP] Skills directory not found: ${SKILLS_DIR}`);
        return [];
    }
    const skillFiles = findAllSkillFiles(skillsRoot, skillsRoot);
    const skills = [];
    for (const filePath of skillFiles) {
        if (filePath.includes('_shared/protocols'))
            continue;
        try {
            if (fs.lstatSync(filePath).isSymbolicLink())
                continue;
            const safeFilePath = resolveContainedPath(filePath, skillsRoot);
            if (!safeFilePath)
                continue;
            const folderName = basename(dirname(safeFilePath));
            const name = folderName;
            const description = `Forgewright Skill: ${name}`;
            skills.push({
                name,
                description,
                filePath: safeFilePath,
            });
        }
        catch (e) {
            console.error(`[Forgewright Global MCP] Failed to read skill: ${filePath}`, e);
        }
    }
    return skills;
}
export function loadSkillOverlay(name) {
    if (!SKILL_NAME.test(name))
        throw new SkillOverlayError('INVALID_SKILL_NAME');
    const skillsRoot = resolveSkillsRoot();
    if (!skillsRoot)
        throw new SkillOverlayError('UNKNOWN_SKILL');
    const matches = findAllSkillFiles(skillsRoot, skillsRoot)
        .filter((filePath) => basename(dirname(filePath)) === name)
        .map((filePath) => dirname(filePath));
    if (matches.length === 0)
        throw new SkillOverlayError('UNKNOWN_SKILL');
    if (matches.length > 1)
        throw new SkillOverlayError('AMBIGUOUS_SKILL');
    const skillDir = matches[0];
    const litePath = join(skillDir, 'LITE.md');
    try {
        if (fs.lstatSync(skillDir).isSymbolicLink() || fs.lstatSync(litePath).isSymbolicLink()) {
            throw new SkillOverlayError('SYMLINK_REJECTED');
        }
        const safePath = resolveContainedPath(litePath, skillsRoot);
        if (!safePath || !fs.statSync(safePath).isFile())
            throw new SkillOverlayError('UNKNOWN_SKILL');
        const bytes = fs.statSync(safePath).size;
        if (bytes > OVERLAY_MAX_BYTES)
            throw new SkillOverlayError('OVERLAY_TOO_LARGE');
        const content = fs.readFileSync(safePath, 'utf8');
        const tokens = Math.ceil(Buffer.byteLength(content, 'utf8') / 4);
        if (tokens > OVERLAY_MAX_TOKENS)
            throw new SkillOverlayError('OVERLAY_TOO_LARGE');
        return {
            name,
            content,
            bytes,
            tokens,
            digest: createHash('sha256').update(content, 'utf8').digest('hex'),
        };
    }
    catch (error) {
        if (error instanceof SkillOverlayError)
            throw error;
        throw new SkillOverlayError('UNKNOWN_SKILL');
    }
}
export function getSharedProtocols() {
    const skillsRoot = resolveSkillsRoot();
    if (!skillsRoot)
        return [];
    const protocolsPath = join(skillsRoot, '_shared', 'protocols');
    const protocolsDir = resolveContainedPath(protocolsPath, skillsRoot);
    if (!protocolsDir)
        return [];
    try {
        if (fs.lstatSync(protocolsPath).isSymbolicLink())
            return [];
    }
    catch {
        return [];
    }
    const files = fs.readdirSync(protocolsDir).filter((f) => f.endsWith('.md'));
    const protocols = [];
    for (const file of files) {
        const filePath = join(protocolsDir, file);
        try {
            if (fs.lstatSync(filePath).isSymbolicLink())
                continue;
            const safeFilePath = resolveContainedPath(filePath, skillsRoot);
            if (!safeFilePath)
                continue;
            const content = fs.readFileSync(safeFilePath, 'utf-8');
            const protocolId = file.replace('.md', '');
            protocols.push({
                name: `protocol-${protocolId}`,
                description: `Forgewright Shared Protocol: ${protocolId}`,
                uri: `fw://protocols/${protocolId}`,
                content,
            });
        }
        catch (e) {
            console.error(`[Forgewright Global MCP] Failed to read protocol: ${filePath}`, e);
        }
    }
    return protocols;
}
