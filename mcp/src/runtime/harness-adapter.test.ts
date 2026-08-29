import { describe, expect, it } from 'vitest';

import {
  HARNESS_ADAPTER_SCHEMA,
  HarnessCompatibilityError,
  negotiateHarnessAdapter,
  validateResumeToken,
  type HarnessAdapter,
  type HarnessCapabilities,
  type ResumeBinding,
} from './harness-adapter.js';

const operations = {
  start: true,
  resume: true,
  fork: false,
  steer: false,
  interrupt: true,
  checkpoint: true,
} as const;

function adapter(capabilities?: Partial<HarnessCapabilities>): HarnessAdapter {
  return {
    schema: HARNESS_ADAPTER_SCHEMA,
    mode: 'native-host-loop',
    capabilities: {
      operations,
      precompact: 'material-event-fallback',
      ...capabilities,
    },
    start: async () => ({ sessionId: 'session-1' }),
    resume: async () => ({ sessionId: 'session-1' }),
    interrupt: async () => undefined,
    checkpoint: async () => ({ checkpointHash: 'a'.repeat(64), ledgerOffset: 7 }),
  };
}

describe('HarnessAdapter v1 compatibility contract', () => {
  it('fails closed when a required lifecycle operation is unsupported', () => {
    expect(() => negotiateHarnessAdapter(adapter(), ['start', 'fork'])).toThrowError(
      new HarnessCompatibilityError('unsupported_operation:fork'),
    );
  });

  it('requires start and every advertised non-start capability implementation', () => {
    const missingStart = adapter();
    delete (missingStart as Partial<HarnessAdapter>).start;
    expect(() => negotiateHarnessAdapter(missingStart, [])).toThrowError(
      'missing_operation_implementation:start',
    );
    const missingAdvertisedResume = adapter();
    delete missingAdvertisedResume.resume;
    expect(() => negotiateHarnessAdapter(missingAdvertisedResume, [])).toThrowError(
      'missing_operation_implementation:resume',
    );
    expect(() => negotiateHarnessAdapter(adapter(), [])).not.toThrow();
  });

  it('rejects unknown capability values instead of guessing host support', () => {
    const malformed = adapter({ precompact: 'unknown' as 'native' });
    expect(() => negotiateHarnessAdapter(malformed, ['start'])).toThrowError(
      'invalid_precompact_capability',
    );
  });

  it('keeps provider model identifiers out of the core compatibility surface', () => {
    const contract = JSON.stringify(negotiateHarnessAdapter(adapter(), ['start']));
    expect(contract).not.toMatch(/model|gpt-|claude-|deepseek-/i);
  });

  it('derives the same capability hash for differently inserted operation keys', () => {
    const reorderedOperations = {
      checkpoint: true,
      interrupt: true,
      steer: false,
      fork: false,
      resume: true,
      start: true,
    };

    expect(negotiateHarnessAdapter(adapter(), ['start']).capabilityHash).toBe(
      negotiateHarnessAdapter(adapter({ operations: reorderedOperations }), ['start'])
        .capabilityHash,
    );
  });

  it('binds resume to workspace, session, turn, checkpoint, ledger and capability snapshot', () => {
    const binding: ResumeBinding = {
      workspaceId: 'workspace-a',
      sessionId: 'session-1',
      turnId: 'turn-4',
      checkpointHash: 'b'.repeat(64),
      ledgerOffset: 11,
      ledgerHeadHash: 'c'.repeat(64),
      capabilityHash: 'd'.repeat(64),
      issuedAt: '2026-08-22T00:00:00.000Z',
      expiresAt: '2026-08-22T01:00:00.000Z',
    };

    expect(validateResumeToken(binding, binding, new Date('2026-08-22T00:30:00.000Z'))).toEqual(
      binding,
    );
    expect(() =>
      validateResumeToken(
        binding,
        { ...binding, workspaceId: 'workspace-b' },
        new Date('2026-08-22T00:30:00.000Z'),
      ),
    ).toThrowError('resume_binding_mismatch:workspaceId');
    expect(() =>
      validateResumeToken(binding, binding, new Date('2026-08-22T01:00:00.001Z')),
    ).toThrowError('resume_token_expired');
  });

  it.each([
    ['negative ledger offset', { ledgerOffset: -1 }, 'resume_binding_invalid_ledger_offset'],
    ['fractional ledger offset', { ledgerOffset: 1.5 }, 'resume_binding_invalid_ledger_offset'],
    [
      'unsafe ledger offset',
      { ledgerOffset: Number.MAX_SAFE_INTEGER + 1 },
      'resume_binding_invalid_ledger_offset',
    ],
    [
      'uppercase checkpoint hash',
      { checkpointHash: 'A'.repeat(64) },
      'resume_binding_invalid_checkpoint_hash',
    ],
    [
      'short ledger head hash',
      { ledgerHeadHash: 'c'.repeat(63) },
      'resume_binding_invalid_ledger_head_hash',
    ],
    [
      'uppercase capability hash',
      { capabilityHash: 'D'.repeat(64) },
      'resume_binding_invalid_capability_hash',
    ],
    ['empty workspace identifier', { workspaceId: '' }, 'resume_binding_invalid_workspace_id'],
    ['unsafe session identifier', { sessionId: 'session/1' }, 'resume_binding_invalid_session_id'],
    [
      'oversized turn identifier',
      { turnId: `t${'x'.repeat(256)}` },
      'resume_binding_invalid_turn_id',
    ],
    [
      'reversed validity range',
      { issuedAt: '2026-08-22T02:00:00.000Z' },
      'resume_token_invalid_time_range',
    ],
  ] as const)('rejects a matching malformed binding: %s', (_name, changes, expectedError) => {
    const valid: ResumeBinding = {
      workspaceId: 'workspace-a',
      sessionId: 'session-1',
      turnId: 'turn-4',
      checkpointHash: 'b'.repeat(64),
      ledgerOffset: 11,
      ledgerHeadHash: 'c'.repeat(64),
      capabilityHash: 'd'.repeat(64),
      issuedAt: '2026-08-22T00:00:00.000Z',
      expiresAt: '2026-08-22T01:00:00.000Z',
    };
    const malformed = { ...valid, ...changes } as ResumeBinding;

    expect(() =>
      validateResumeToken(malformed, malformed, new Date('2026-08-22T00:30:00.000Z')),
    ).toThrowError(expectedError);
  });

  it('accepts 128-character identifiers and rejects 129-character identifiers', () => {
    const binding: ResumeBinding = {
      workspaceId: `w${'x'.repeat(127)}`,
      sessionId: `s${'x'.repeat(127)}`,
      turnId: `t${'x'.repeat(127)}`,
      checkpointHash: 'b'.repeat(64),
      ledgerOffset: 1,
      ledgerHeadHash: 'c'.repeat(64),
      capabilityHash: 'd'.repeat(64),
      issuedAt: '2026-08-22T00:00:00.000Z',
      expiresAt: '2026-08-22T01:00:00.000Z',
    };
    expect(validateResumeToken(binding, binding, new Date('2026-08-22T00:30:00.000Z'))).toEqual(
      binding,
    );
    expect(() =>
      validateResumeToken(
        { ...binding, turnId: `t${'x'.repeat(128)}` },
        { ...binding, turnId: `t${'x'.repeat(128)}` },
        new Date('2026-08-22T00:30:00.000Z'),
      ),
    ).toThrowError('resume_binding_invalid_turn_id');
  });
});
