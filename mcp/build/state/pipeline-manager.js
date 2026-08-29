import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import os from 'os';
import { DEFAULT_STATE, PIPELINE_PHASES, PHASE_KEYS, parsePipelineState, } from '../core/models/PipelineState.js';
import { PipelineService } from '../core/services/PipelineService.js';
import { StateQueryService } from '../core/services/StateQueryService.js';
import { FileSystemStateRepository } from '../infrastructure/adapters/FileSystemStateRepository.js';
import { McpEventPublisher } from '../infrastructure/adapters/McpEventPublisher.js';
import { FileLogEventPublisher } from '../infrastructure/adapters/FileLogEventPublisher.js';
import { CombinedEventPublisher } from '../infrastructure/adapters/CombinedEventPublisher.js';
import { createHttpWebhookPublisher } from './rpc-client.js';
// Re-export models for backward compatibility
export { DEFAULT_STATE, PIPELINE_PHASES, PHASE_KEYS };
// ─── Forgewright Root Detection ──────────────────────────────────────
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const MCP_BUILD_DIR = __dirname;
const MCP_ROOT_DIR = path.dirname(MCP_BUILD_DIR);
const FORGEWRIGHT_ROOT = path.dirname(MCP_ROOT_DIR);
let _forgewrightRoot = null;
let _workspaceRoot = null;
function _getForgewrightRoot() {
    if (!_forgewrightRoot) {
        let dir = __dirname;
        for (let i = 0; i < 10; i++) {
            if (fs.existsSync(path.join(dir, 'package.json'))) {
                _forgewrightRoot = path.dirname(dir);
                return _forgewrightRoot;
            }
            const parent = path.dirname(dir);
            if (parent === dir)
                break;
            dir = parent;
        }
        _forgewrightRoot = path.resolve(FORGEWRIGHT_ROOT);
    }
    return _forgewrightRoot;
}
export function getForgewrightRoot() {
    return _getForgewrightRoot();
}
export function _isResolvedPath(p) {
    if (!p)
        return false;
    if (/\$\{[^}]+\}/.test(p)) {
        console.error(`[Forgewright Global MCP] Warning: Skipping unresolved template variable in path: "${p}"`);
        return false;
    }
    return true;
}
export function setWorkspaceRoot() {
    if (_workspaceRoot)
        return;
    const candidates = [
        process.env.FORGEWRIGHT_WORKSPACE,
        process.env.CURSOR_WORKSPACE_ROOT,
        process.env.CLASSD_WORKSPACE_ROOT,
        process.env.AGENTS_WORKSPACE,
    ];
    let ws = candidates.find(_isResolvedPath) || undefined;
    if (!ws) {
        const candidate = path.join(process.cwd(), '.forgewright');
        if (fs.existsSync(candidate)) {
            ws = process.cwd();
        }
    }
    if (!ws) {
        console.error(`[Forgewright Global MCP] Warning: Could not detect workspace. Using FORGEWRIGHT_ROOT.`);
        ws = _getForgewrightRoot();
    }
    _workspaceRoot = path.resolve(ws);
    process.chdir(_workspaceRoot);
    console.error(`[Forgewright Global MCP] Workspace: ${_workspaceRoot}`);
}
export function getWorkspaceRoot() {
    if (!_workspaceRoot) {
        setWorkspaceRoot();
    }
    return _workspaceRoot;
}
export function resetWorkspaceRoot() {
    _workspaceRoot = null;
    pipelineService = null;
    queryService = null;
    combinedEventPublisher = null;
}
// ─── Service Instances (Singleton pattern) ───────────────────────────────────
let pipelineService = null;
let queryService = null;
let combinedEventPublisher = null;
function getServices() {
    if (!pipelineService || !queryService) {
        const wsRoot = getWorkspaceRoot();
        const sessionId = process.env.FORGEWRIGHT_SESSION_ID;
        const stateRepo = new FileSystemStateRepository(wsRoot, 'pipeline-state.json', parsePipelineState);
        const mcpPublisher = new McpEventPublisher(wsRoot, sessionId);
        // Note: To truly set the server on mcpPublisher, we need a way to pass it.
        // rpc-client.ts is handling the server right now.
        const filePublisher = new FileLogEventPublisher(wsRoot);
        const httpPublisher = createHttpWebhookPublisher(wsRoot, sessionId);
        combinedEventPublisher = new CombinedEventPublisher([
            mcpPublisher,
            filePublisher,
            httpPublisher,
        ]);
        pipelineService = new PipelineService(stateRepo, combinedEventPublisher);
        queryService = new StateQueryService(stateRepo);
    }
    return { pipelineService, queryService, combinedEventPublisher };
}
// ─── Wrappers for backward compatibility ────────────────────────────────────
export async function getState() {
    const { queryService } = getServices();
    return queryService.getState();
}
export async function startPipeline(mode) {
    const { pipelineService } = getServices();
    return pipelineService.startPipeline(mode);
}
export async function advancePhase() {
    const { pipelineService } = getServices();
    return pipelineService.advancePhase();
}
export async function requestGateApproval(message, qualityGate) {
    const { pipelineService } = getServices();
    return pipelineService.requestGateApproval(message, qualityGate);
}
export async function approveGate() {
    const { pipelineService } = getServices();
    return pipelineService.approveGate();
}
export async function updateSubTask(activeAction, phaseProgress) {
    const { pipelineService } = getServices();
    return pipelineService.updateSubTask(activeAction, phaseProgress);
}
export async function updateSelfHealing(selfHealing) {
    const { pipelineService } = getServices();
    return pipelineService.updateSelfHealing(selfHealing);
}
export async function failPipeline(reason) {
    const { pipelineService } = getServices();
    return pipelineService.failPipeline(reason);
}
export async function checkPipelineCompliance(maxStateAgeMinutes = 120) {
    const wsRoot = getWorkspaceRoot();
    const state = await getState();
    const stateFile = path.join(wsRoot, '.forgewright', 'pipeline-state.json');
    const issues = [];
    const warnings = [];
    const recommendations = [];
    let stateAgeMinutes = null;
    if (fs.existsSync(stateFile)) {
        const ageMs = Date.now() - fs.statSync(stateFile).mtimeMs;
        stateAgeMinutes = Math.max(0, Math.floor(ageMs / 60000));
    }
    else {
        warnings.push('pipeline-state.json does not exist yet');
        recommendations.push('Call fw_start_pipeline at the start of the next user request.');
    }
    if (state.status === 'IDLE') {
        warnings.push('pipeline is idle');
        recommendations.push('Call fw_start_pipeline before executing user work.');
    }
    if (state.status === 'IN_PROGRESS' && !state.currentMode) {
        issues.push('pipeline is in progress without a current mode');
        recommendations.push('Restart the pipeline with fw_start_pipeline and a concrete mode.');
    }
    if (state.status === 'IN_PROGRESS' &&
        stateAgeMinutes !== null &&
        stateAgeMinutes > maxStateAgeMinutes) {
        issues.push(`pipeline state is stale (${stateAgeMinutes}m > ${maxStateAgeMinutes}m)`);
        recommendations.push('Update progress with fw_update_subtask or close the pipeline phase.');
    }
    if (state.status === 'WAITING_FOR_GATE') {
        warnings.push('pipeline is waiting for human gate approval');
        recommendations.push('Do not advance phases until the user approves the gate.');
    }
    return {
        ok: issues.length === 0,
        status: state.status,
        currentMode: state.currentMode,
        currentPhase: state.currentPhase,
        stateAgeMinutes,
        issues,
        warnings,
        recommendations,
    };
}
export function logTokenUsage(entry) {
    const wsRoot = getWorkspaceRoot();
    const folderName = path.basename(wsRoot);
    const usageDir = path.join(os.homedir(), '.forgewright', 'usage', folderName);
    if (!fs.existsSync(usageDir)) {
        fs.mkdirSync(usageDir, { recursive: true });
    }
    const logFile = path.join(usageDir, 'usage.log');
    fs.appendFileSync(logFile, JSON.stringify(entry) + '\n', 'utf-8');
    // Forward to Event Publisher
    const { combinedEventPublisher } = getServices();
    if (combinedEventPublisher) {
        combinedEventPublisher.publish('COST_UPDATE', entry);
    }
}
