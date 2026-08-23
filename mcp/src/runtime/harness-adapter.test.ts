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
});
