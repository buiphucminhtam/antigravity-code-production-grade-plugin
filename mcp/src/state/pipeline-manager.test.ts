import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { createHash } from 'node:crypto';
import {
  _resetRpcClientForTests,
  _setWebhookPublisherFactoryForTests,
  setRuntimeTrustContext,
} from './rpc-client.js';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'forgewright-test-'));
process.env.CURSOR_WORKSPACE_ROOT = tmpDir;

const STATE_FILE = path.join(tmpDir, '.forgewright', 'pipeline-state.json');

function cleanState() {
  if (fs.existsSync(STATE_FILE)) fs.unlinkSync(STATE_FILE);
}

describe('Pipeline Manager', () => {
  beforeEach(() => {
    _resetRpcClientForTests();
    cleanState();
  });

  afterEach(() => {
    _resetRpcClientForTests();
    cleanState();
  });

  afterAll(() => {
    try {
      if (fs.existsSync(tmpDir)) {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    } catch (e) {
      console.error('Failed to clean up temp test directory:', e);
    }
  });

  it('getState returns default state when no state file exists', async () => {
    const { getState, resetWorkspaceRoot } = await import('../state/pipeline-manager.js');
    resetWorkspaceRoot();
    cleanState();
    const state = await getState();
    expect(state.currentPhase).toBe(0);
    expect(state.status).toBe('IDLE');
    expect(state.currentMode).toBeNull();
  });

  it('startPipeline sets mode and phase', async () => {
    const { startPipeline, getState, resetWorkspaceRoot } =
      await import('../state/pipeline-manager.js');
    resetWorkspaceRoot();
    cleanState();
    const result = await startPipeline('Full Build');
    expect(result).toContain('Full Build');
    expect(result).toContain('Phase 1');
    const state = await getState();
    expect(state.currentMode).toBe('Full Build');
    expect(state.currentPhase).toBe(1);
    expect(state.status).toBe('IN_PROGRESS');
  });

  it('shares validated webhook authority with pipeline service publication only', async () => {
    const { startPipeline, resetWorkspaceRoot } = await import('../state/pipeline-manager.js');
    const observed: Array<unknown> = [];
    _setWebhookPublisherFactoryForTests((_workspace, _session, options) => ({
      publish: vi.fn(() => observed.push(options.callerIdentity)),
    }));
    resetWorkspaceRoot();
    await startPipeline('Local');
    expect(observed.at(-1)).toBeUndefined();

    cleanState();
    resetWorkspaceRoot();
    const profileDigest = createHash('sha256').update('production:application').digest('hex');
    const workspaceId = createHash('sha256').update(tmpDir).digest('hex');
    setRuntimeTrustContext(
      {
        mode: 'production',
        workspace: tmpDir,
        callerId: 'production-caller',
        profile: 'application',
        profileDigest,
        policyDigest: 'd'.repeat(64),
      },
      workspaceId,
      'session-a',
    );
    await startPipeline('Production');

    expect(observed.at(-1)).toMatchObject({
      mode: 'production',
      callerId: 'production-caller',
      workspaceId,
      profileDigest,
      policyDigest: 'd'.repeat(64),
    });
  });

  it('advancePhase increments phase', async () => {
    const { startPipeline, advancePhase, getState, resetWorkspaceRoot } =
      await import('../state/pipeline-manager.js');
    resetWorkspaceRoot();
    cleanState();
    await startPipeline('Feature');
    const result = await advancePhase();
    expect(result).toContain('Phase 2');
    expect((await getState()).currentPhase).toBe(2);
  });

  it('advancePhase blocked when waiting for gate', async () => {
    const { startPipeline, requestGateApproval, advancePhase, resetWorkspaceRoot } =
      await import('../state/pipeline-manager.js');
    resetWorkspaceRoot();
    cleanState();
    await startPipeline('Feature');
    await requestGateApproval('test gate');
    const revision = JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8')).revision;
    const result = await advancePhase();
    expect(result).toContain('Error');
    expect(result).toContain('frozen');
    expect(JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8')).revision).toBe(revision);
  });

  it('advancePhase completes pipeline at end', async () => {
    const { startPipeline, advancePhase, getState, resetWorkspaceRoot } =
      await import('../state/pipeline-manager.js');
    resetWorkspaceRoot();
    cleanState();
    await startPipeline('Feature');
    for (let i = 0; i < 5; i++) {
      const { status } = await getState();
      if (status === 'COMPLETED') break;
      await advancePhase();
    }
    const state = await getState();
    expect(state.status).toBe('COMPLETED');
  });

  it('requestGateApproval locks pipeline', async () => {
    const { startPipeline, requestGateApproval, getState, resetWorkspaceRoot } =
      await import('../state/pipeline-manager.js');
    resetWorkspaceRoot();
    cleanState();
    await startPipeline('Feature');
    const result = await requestGateApproval('GDD is ready');
    expect(result).toContain('locked');
    expect(result).toContain('GDD is ready');
    expect((await getState()).status).toBe('WAITING_FOR_GATE');
  });

  it('approveGate unlocks pipeline', async () => {
    const { startPipeline, requestGateApproval, approveGate, getState, resetWorkspaceRoot } =
      await import('../state/pipeline-manager.js');
    resetWorkspaceRoot();
    cleanState();
    await startPipeline('Feature');
    await requestGateApproval('test');
    const result = await approveGate();
    expect(result).toContain('approved');
    expect((await getState()).status).toBe('IN_PROGRESS');
  });

  it('approveGate errors when not waiting', async () => {
    const { startPipeline, approveGate, resetWorkspaceRoot } =
      await import('../state/pipeline-manager.js');
    resetWorkspaceRoot();
    cleanState();
    await startPipeline('Feature');
    const revision = JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8')).revision;
    const result = await approveGate();
    expect(result).toContain('Error');
    expect(JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8')).revision).toBe(revision);
  });

  it('PIPELINE_PHASES has correct phases', async () => {
    const { PIPELINE_PHASES } = await import('../state/pipeline-manager.js');
    expect(PIPELINE_PHASES.length).toBe(5);
    expect(PIPELINE_PHASES[0]).toContain('Phase 0');
    expect(PIPELINE_PHASES[4]).toContain('Phase 4');
  });

  it('getState backward compatibility fills undefined fields with null', async () => {
    const { getState, resetWorkspaceRoot } = await import('../state/pipeline-manager.js');
    resetWorkspaceRoot();
    cleanState();

    // Write legacy JSON state
    const legacyState = {
      currentPhase: 1,
      currentMode: 'Harden',
      status: 'IN_PROGRESS',
      history: ['Initial'],
    };

    fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify(legacyState), 'utf-8');

    const state = await getState();
    expect(state.currentPhase).toBe(1);
    expect(state.status).toBe('IN_PROGRESS');
    expect(state.activeAction).toBeNull();
    expect(state.phaseProgress).toBeNull();
    expect(state.selfHealing).toBeNull();
    expect(state.qualityGate).toBeNull();
    expect(state.phases).toBeDefined();
    expect(state.phases.length).toBe(5);
    expect(state.phases[0].key).toBe('interpret');
    expect(state.phases[0].status).toBe('passed');
    expect(state.phases[1].status).toBe('running');
  });

  it('requestGateApproval accepts qualityGate details', async () => {
    const { startPipeline, requestGateApproval, getState, resetWorkspaceRoot } =
      await import('../state/pipeline-manager.js');
    resetWorkspaceRoot();
    cleanState();
    await startPipeline('Feature');

    const gateInfo = {
      score: 8.5,
      threshold: 9.0,
      failedCriteria: [
        {
          name: 'Risk Awareness',
          score: 7.5,
          reason: 'Missing rollback strategies',
        },
      ],
    };

    await requestGateApproval('test gate', gateInfo);

    const state = await getState();
    expect(state.status).toBe('WAITING_FOR_GATE');
    expect(state.qualityGate).toEqual(gateInfo);
  });

  it('updateSubTask and updateSelfHealing mutate state', async () => {
    const { startPipeline, updateSubTask, updateSelfHealing, getState, resetWorkspaceRoot } =
      await import('../state/pipeline-manager.js');
    resetWorkspaceRoot();
    cleanState();
    await startPipeline('Feature');

    await updateSubTask('Running Vitest...', 0.65);
    let state = await getState();
    expect(state.activeAction).toBe('Running Vitest...');
    expect(state.phaseProgress).toBe(0.65);

    const healing = {
      isHealing: true,
      currentAttempt: 2,
      maxAttempts: 3,
      lastError: 'Vitest assertion error',
    };

    await updateSelfHealing(healing);
    state = await getState();
    expect(state.selfHealing).toEqual(healing);
  });

  it('failPipeline updates status to FAILED and clears progress/action details', async () => {
    const { startPipeline, updateSubTask, failPipeline, getState, resetWorkspaceRoot } =
      await import('../state/pipeline-manager.js');
    resetWorkspaceRoot();
    cleanState();
    await startPipeline('Feature');
    await updateSubTask('Working on it', 0.8);

    const result = await failPipeline('Compiling failed');
    expect(result).toContain('FAILED');

    const state = await getState();
    expect(state.status).toBe('FAILED');
    expect(state.history).toContain('Pipeline failed: Compiling failed');
    expect(state.activeAction).toBeNull();
    expect(state.phaseProgress).toBeNull();
    expect(state.selfHealing).toBeNull();
    expect(state.qualityGate).toBeNull();
  });

  it('checkPipelineCompliance passes for a fresh active pipeline', async () => {
    const { startPipeline, checkPipelineCompliance, resetWorkspaceRoot } =
      await import('../state/pipeline-manager.js');
    resetWorkspaceRoot();
    cleanState();
    await startPipeline('Harden');

    const report = await checkPipelineCompliance(120);
    expect(report.ok).toBe(true);
    expect(report.status).toBe('IN_PROGRESS');
    expect(report.currentMode).toBe('Harden');
    expect(report.issues).toEqual([]);
  });

  it('checkPipelineCompliance flags stale active pipeline state', async () => {
    const { startPipeline, checkPipelineCompliance, resetWorkspaceRoot } =
      await import('../state/pipeline-manager.js');
    resetWorkspaceRoot();
    cleanState();
    await startPipeline('Harden');

    const staleDate = new Date(Date.now() - 10 * 60 * 1000);
    fs.utimesSync(STATE_FILE, staleDate, staleDate);

    const report = await checkPipelineCompliance(1);
    expect(report.ok).toBe(false);
    expect(report.issues.some((issue) => issue.includes('stale'))).toBe(true);
  });

  it('logTokenUsage logs usage in JSON Lines format to ~/.forgewright/usage/<folderName>/usage.log', async () => {
    const { logTokenUsage, resetWorkspaceRoot, getWorkspaceRoot } =
      await import('../state/pipeline-manager.js');
    resetWorkspaceRoot();

    const entry = {
      inputTokens: 1024,
      outputTokens: 256,
      model: 'claude-3-5-sonnet-20241022',
      provider: 'anthropic',
      cost: 0.0069,
      timestamp: '2026-06-26T13:04:00Z',
      skill: 'software-engineer',
    };

    logTokenUsage(entry);

    const wsRoot = getWorkspaceRoot();
    const folderName = path.basename(wsRoot);
    const logDir = path.join(os.homedir(), '.forgewright', 'usage', folderName);
    const logFile = path.join(logDir, 'usage.log');

    expect(fs.existsSync(logFile)).toBe(true);
    const content = fs.readFileSync(logFile, 'utf-8');
    const parsed = JSON.parse(content.trim());
    expect(parsed).toEqual(entry);

    // Clean up
    try {
      fs.rmSync(logDir, { recursive: true, force: true });
    } catch (e) {
      console.error('Failed to clean up test usage log:', e);
    }
  });
});

describe('_isResolvedPath — IDE template variable guard', () => {
  it('rejects undefined', async () => {
    const { _isResolvedPath } = await import('../state/pipeline-manager.js');
    expect(_isResolvedPath(undefined)).toBe(false);
  });

  it('rejects empty string', async () => {
    const { _isResolvedPath } = await import('../state/pipeline-manager.js');
    expect(_isResolvedPath('')).toBe(false);
  });

  it('rejects literal ${workspaceFolder}', async () => {
    const { _isResolvedPath } = await import('../state/pipeline-manager.js');
    expect(_isResolvedPath('${workspaceFolder}')).toBe(false);
  });

  it('rejects path containing unresolved ${workspaceFolder}', async () => {
    const { _isResolvedPath } = await import('../state/pipeline-manager.js');
    expect(_isResolvedPath('/Users/test/project/${workspaceFolder}')).toBe(false);
  });

  it('rejects other unresolved template variables like ${env:HOME}', async () => {
    const { _isResolvedPath } = await import('../state/pipeline-manager.js');
    expect(_isResolvedPath('${env:HOME}/project')).toBe(false);
  });

  it('accepts a valid absolute path', async () => {
    const { _isResolvedPath } = await import('../state/pipeline-manager.js');
    expect(_isResolvedPath('/Users/test/my-project')).toBe(true);
  });

  it('accepts a valid relative path', async () => {
    const { _isResolvedPath } = await import('../state/pipeline-manager.js');
    expect(_isResolvedPath('./my-project')).toBe(true);
  });

  it('accepts path with $ but not in ${} syntax', async () => {
    const { _isResolvedPath } = await import('../state/pipeline-manager.js');
    expect(_isResolvedPath('/Users/$admin/project')).toBe(true);
  });
});
