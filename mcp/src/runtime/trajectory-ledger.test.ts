import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  EVENT_KINDS,
  MAX_CONTROL_CAUSAL_EVENT_IDS,
  MAX_CONTROL_EVENT_BYTES,
  TrajectoryLedger,
  TrajectoryLedgerError,
  canonicalJson,
  foldTrajectory,
  type AppendEventInput,
  type TrajectoryLedgerOptions,
} from './trajectory-ledger.js';
import { createHash } from 'node:crypto';

const roots: string[] = [];

function receiptDigest(summary: Record<string, unknown>, sequence: number, hash: string): string {
  return createHash('sha256')
    .update(canonicalJson({ ...summary, predecessorTip: { sequence, hash } }), 'utf8')
    .digest('hex');
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture(options: Partial<Omit<TrajectoryLedgerOptions, 'root' | 'ledgerId'>> = {}) {
  const root = mkdtempSync(join(tmpdir(), 'forgewright-trajectory-'));
  roots.push(root);
  return {
    root,
    ledger: new TrajectoryLedger({ root, ledgerId: 'trajectory-a', ...options }),
  };
}

function opened(eventId = 'event-open'): Extract<AppendEventInput, { kind: 'trajectory.opened' }> {
  return {
    eventId,
    kind: 'trajectory.opened',
    occurredAtMs: 1,
    causalEventIds: [],
    payload: {
      objectiveDigest: 'a'.repeat(64),
      workspaceId: 'workspace-a',
      sessionId: 'session-a',
      origin: 'test',
      writerEpoch: 1,
      rootScopeId: 'scope-root',
    },
  };
}

function cancellation(
  eventId: string,
  at: number,
): Extract<AppendEventInput, { kind: 'cancellation.requested' }> {
  return {
    eventId,
    kind: 'cancellation.requested',
    occurredAtMs: at,
    causalEventIds: ['event-open'],
    payload: { scopeId: null, reasonCode: 'operator_requested' },
  };
}

async function expectCode(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toMatchObject({ code });
}

function eventPaths(root: string) {
  return readdirSync(join(root, 'trajectory-a'))
    .filter((name) => name.endsWith('.event.json'))
    .sort()
    .map((name) => join(root, 'trajectory-a', name));
}

describe('canonical JSON', () => {
  it('has stable UTF-8 vectors independent of insertion order', () => {
    expect(canonicalJson({ z: [3, 'é'], a: { y: true, x: null } })).toBe(
      '{"a":{"x":null,"y":true},"z":[3,"é"]}',
    );
    expect(canonicalJson({ b: 2, a: 1 })).toBe(canonicalJson({ a: 1, b: 2 }));
  });

  it.each([1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1, -0])(
    'rejects a number outside the safe-integer subset: %s',
    (value) => {
      expect(() => canonicalJson({ value })).toThrowError(TrajectoryLedgerError);
    },
  );
});

describe('trajectory fold', () => {
  it('deterministically derives lifecycle state', async () => {
    const { ledger } = fixture();
    await ledger.append(opened());
    await ledger.append({
      eventId: 'scope-open',
      kind: 'scope.opened',
      occurredAtMs: 2,
      causalEventIds: ['event-open'],
      payload: { scopeId: 'scope-a', parentScopeId: null, scopeType: 'turn' },
    });
    await ledger.append({
      eventId: 'operation-start',
      kind: 'operation.started',
      occurredAtMs: 3,
      causalEventIds: ['scope-open'],
      payload: {
        operationId: 'operation-a',
        scopeId: 'scope-a',
        operationType: 'tool',
        inputDigest: 'b'.repeat(64),
      },
    });
    const events = await ledger.reconstruct();

    expect(foldTrajectory(events)).toEqual({
      opened: true,
      recoveredCount: 0,
      latestWriterEpoch: 1,
      terminal: null,
      openScopeIds: ['scope-a'],
      activeOperationIds: ['operation-a'],
      pendingDisposerIds: [],
      cancellationRequested: false,
      cancellationAcknowledged: false,
      finalizationStarted: false,
      finalizationReceiptCount: 0,
    });
    expect(foldTrajectory(events)).toEqual(foldTrajectory(structuredClone(events)));
  });
});

describe('TrajectoryLedger durable chain', () => {
  it('persists a canonical SHA-256 chain with private modes', async () => {
    const { root, ledger } = fixture();
    const first = await ledger.append(opened());
    const second = await ledger.append(cancellation('cancel-a', 2), first.tip);
    const events = await ledger.reconstruct();

    expect(first.status).toBe('appended');
    expect(second.status).toBe('appended');
    expect(events.map((event) => event.sequence)).toEqual([1, 2]);
    expect(events[1].previousHash).toBe(events[0].hash);
    expect(await ledger.tip()).toEqual({ sequence: 2, hash: events[1].hash });
    if (process.platform !== 'win32') {
      expect(lstatSync(join(root, 'trajectory-a')).mode & 0o777).toBe(0o700);
    }
    for (const path of eventPaths(root)) {
      if (process.platform !== 'win32') expect(lstatSync(path).mode & 0o777).toBe(0o600);
      const raw = readFileSync(path, 'utf8');
      expect(raw).toBe(`${canonicalJson(JSON.parse(raw))}\n`);
    }
  });

  it.each([
    [
      'payload',
      (record: Record<string, unknown>) =>
        ((record.payload as Record<string, unknown>).reasonCode = 'changed'),
    ],
    ['hash', (record: Record<string, unknown>) => (record.hash = '0'.repeat(64))],
    ['previous hash', (record: Record<string, unknown>) => (record.previousHash = '0'.repeat(64))],
  ])('fails closed after %s tampering', async (_label, mutate) => {
    const { root, ledger } = fixture();
    await ledger.append(opened());
    await ledger.append(cancellation('cancel-a', 2));
    const target = eventPaths(root)[1];
    const record = JSON.parse(readFileSync(target, 'utf8')) as Record<string, unknown>;
    mutate(record);
    writeFileSync(target, `${canonicalJson(record)}\n`);

    await expectCode(ledger.reconstruct(), 'CHAIN_CORRUPT');
  });

  it('rejects deletion/sequence gaps, missing newline, and malformed JSON', async () => {
    const gap = fixture();
    await gap.ledger.append(opened());
    await gap.ledger.append(cancellation('cancel-a', 2));
    unlinkSync(eventPaths(gap.root)[0]);
    await expectCode(gap.ledger.reconstruct(), 'SEQUENCE_GAP');

    const newline = fixture();
    await newline.ledger.append(opened());
    const newlinePath = eventPaths(newline.root)[0];
    writeFileSync(newlinePath, readFileSync(newlinePath, 'utf8').trimEnd());
    await expectCode(newline.ledger.reconstruct(), 'RECORD_MISSING_NEWLINE');

    const malformed = fixture();
    await malformed.ledger.append(opened());
    writeFileSync(eventPaths(malformed.root)[0], '{not-json}\n');
    await expectCode(malformed.ledger.reconstruct(), 'MALFORMED_RECORD');
  });

  it('checks per-record and aggregate byte limits before JSON parsing', async () => {
    const perRecord = fixture({ maxEventBytes: 128 });
    const dir = join(perRecord.root, 'trajectory-a');
    await perRecord.ledger.reconstruct();
    writeFileSync(join(dir, '00000000000000000001.event.json'), 'x'.repeat(129), { mode: 0o600 });
    await expectCode(perRecord.ledger.reconstruct(), 'EVENT_TOO_LARGE');

    const total = fixture({ maxEventBytes: 512, maxTotalBytes: 100 });
    const totalDir = join(total.root, 'trajectory-a');
    await total.ledger.reconstruct();
    writeFileSync(join(totalDir, '00000000000000000001.event.json'), '{broken'.repeat(20), {
      mode: 0o600,
    });
    await expectCode(total.ledger.reconstruct(), 'LEDGER_TOO_LARGE');
  });

  it('checks event-count limits before parsing any record', async () => {
    const { root, ledger } = fixture({ maxEvents: 2, finalizationReserve: 1 });
    const dir = join(root, 'trajectory-a');
    await ledger.reconstruct();
    for (let sequence = 1; sequence <= 3; sequence += 1) {
      writeFileSync(
        join(dir, `${String(sequence).padStart(20, '0')}.event.json`),
        '{malformed}\n',
        { mode: 0o600 },
      );
    }

    await expectCode(ledger.reconstruct(), 'EVENT_COUNT_EXCEEDED');
  });

  it('rejects non-UTF-8 record bytes', async () => {
    const { root, ledger } = fixture();
    await ledger.reconstruct();
    writeFileSync(
      join(root, 'trajectory-a', '00000000000000000001.event.json'),
      Buffer.from([0xff, 0x0a]),
      { mode: 0o600 },
    );

    await expectCode(ledger.reconstruct(), 'MALFORMED_RECORD');
  });

  it('linearizes racing instances with one winner and a contiguous retry', async () => {
    const { root, ledger } = fixture();
    const peer = new TrajectoryLedger({ root, ledgerId: 'trajectory-a' });
    await ledger.append(opened());
    const results = await Promise.all([
      ledger.append(cancellation('cancel-a', 2)),
      peer.append(cancellation('cancel-b', 3)),
    ]);
    const events = await ledger.reconstruct();

    expect(results.map((result) => result.event.sequence).sort()).toEqual([2, 3]);
    expect(events.map((event) => event.sequence)).toEqual([1, 2, 3]);
    expect(new Set(events.map((event) => event.hash)).size).toBe(3);
  });

  it('requires exactly one trajectory.opened event at sequence one', async () => {
    const { ledger } = fixture();
    await expectCode(ledger.append(cancellation('cancel-a', 1)), 'INVALID_EVENT');
    await ledger.append(opened());
    await expectCode(ledger.append(opened('open-again')), 'INVALID_EVENT');
  });

  it('returns an identical duplicate idempotently and rejects a mutated duplicate', async () => {
    const { ledger } = fixture();
    const input = opened();
    const first = await ledger.append(input);
    const duplicate = await ledger.append(structuredClone(input));

    expect(duplicate).toMatchObject({ status: 'idempotent', event: first.event });
    await expectCode(
      ledger.append({
        ...input,
        payload: { ...input.payload, objectiveDigest: 'f'.repeat(64) },
      }),
      'DUPLICATE_EVENT_CONFLICT',
    );
    expect((await ledger.reconstruct()).length).toBe(1);
  });

  it('honors expected tips and refuses appends after terminal', async () => {
    const { ledger } = fixture();
    await ledger.append(opened());
    await expectCode(ledger.append(cancellation('cancel-a', 2), null), 'EXPECTED_TIP_MISMATCH');
    await ledger.append({
      eventId: 'terminal-a',
      kind: 'trajectory.terminal',
      occurredAtMs: 3,
      causalEventIds: ['event-open'],
      payload: {
        outcome: 'cancelled',
        summaryDigest: 'c'.repeat(64),
        cleanupOutcome: 'completed',
        quiescence: 'confirmed',
        receiptEventId: 'event-open',
      },
    });
    await expectCode(ledger.append(cancellation('cancel-b', 4)), 'TRAJECTORY_TERMINAL');
  });

  it('repairs a lagging advisory head but rejects a same-sequence mismatch', async () => {
    const { root, ledger } = fixture();
    const first = await ledger.append(opened());
    await ledger.append(cancellation('cancel-a', 2));
    const headPath = join(root, 'trajectory-a', 'HEAD.json');
    writeFileSync(
      headPath,
      `${canonicalJson({ schema: 'forgewright-trajectory-head/v1', ledgerId: 'trajectory-a', sequence: 1, hash: first.event.hash })}\n`,
      { mode: 0o600 },
    );
    expect((await ledger.reconstruct()).length).toBe(2);
    expect(JSON.parse(readFileSync(headPath, 'utf8')).sequence).toBe(2);

    const head = JSON.parse(readFileSync(headPath, 'utf8'));
    head.hash = '0'.repeat(64);
    writeFileSync(headPath, `${canonicalJson(head)}\n`);
    await expectCode(ledger.reconstruct(), 'HEAD_CORRUPT');
  });

  it('rejects symlinked trajectory directories and event files', async () => {
    const directory = fixture();
    const outside = mkdtempSync(join(tmpdir(), 'forgewright-trajectory-outside-'));
    roots.push(outside);
    symlinkSync(
      outside,
      join(directory.root, 'trajectory-a'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    await expectCode(directory.ledger.reconstruct(), 'SYMLINK_REJECTED');

    if (process.platform !== 'win32') {
      const record = fixture();
      await record.ledger.reconstruct();
      const target = join(record.root, 'target');
      writeFileSync(target, '{}\n');
      symlinkSync(target, join(record.root, 'trajectory-a', '00000000000000000001.event.json'));
      await expectCode(record.ledger.reconstruct(), 'SYMLINK_REJECTED');
    }

    const ancestorRoot = mkdtempSync(join(tmpdir(), 'forgewright-trajectory-ancestor-'));
    const ancestorOutside = mkdtempSync(join(tmpdir(), 'forgewright-trajectory-ancestor-outside-'));
    roots.push(ancestorRoot, ancestorOutside);
    mkdirSync(join(ancestorRoot, 'canonical'));
    symlinkSync(
      ancestorOutside,
      join(ancestorRoot, 'canonical', 'linked'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    const ancestorLedger = new TrajectoryLedger({
      root: join(ancestorRoot, 'canonical', 'linked', 'nested'),
      ledgerId: 'trajectory-a',
    });
    await expectCode(ancestorLedger.reconstruct(), 'SYMLINK_REJECTED');
  });

  it('reserves ordinary capacity for cancellation, finalization, and terminal controls', async () => {
    const { ledger } = fixture({ maxEvents: 8, finalizationReserve: 5 });
    await ledger.append(opened());
    await ledger.append({
      eventId: 'scope-open',
      kind: 'scope.opened',
      occurredAtMs: 2,
      causalEventIds: ['event-open'],
      payload: { scopeId: 'scope-a', parentScopeId: null, scopeType: 'test' },
    });
    await ledger.append(cancellation('cancel-a', 4));
    await ledger.append({
      eventId: 'cancel-ack',
      kind: 'cancellation.acknowledged',
      occurredAtMs: 5,
      causalEventIds: ['cancel-a'],
      payload: { requestEventId: 'cancel-a', scopeId: 'scope-root', observedOperationCount: 0 },
    });
    await ledger.append({
      eventId: 'finalization-start',
      kind: 'finalization.started',
      occurredAtMs: 6,
      causalEventIds: ['cancel-ack'],
      payload: { reasonCode: 'capacity', deadlineAtMs: 100 },
    });
    const scopeClosed = await ledger.append({
      eventId: 'scope-close',
      kind: 'scope.closed',
      occurredAtMs: 6,
      causalEventIds: ['scope-open'],
      payload: { scopeId: 'scope-a', outcome: 'completed' },
    });
    await ledger.append({
      eventId: 'finalization-receipt',
      kind: 'finalization.receipt',
      occurredAtMs: 7,
      causalEventIds: ['scope-close'],
      payload: {
        status: 'complete',
        disposedCount: 0,
        failedDisposerCount: 0,
        timedOutDisposerCount: 0,
        unresolvedOperationCount: 0,
        unresolvedScopeCount: 0,
        unresolvedDisposerCount: 0,
        deadlineAtMs: 100,
        quiescence: 'confirmed',
        predecessorSequence: 6,
        predecessorHash: scopeClosed.event.hash,
        receiptDigest: receiptDigest(
          {
            status: 'complete',
            disposedCount: 0,
            failedDisposerCount: 0,
            timedOutDisposerCount: 0,
            unresolvedOperationCount: 0,
            unresolvedScopeCount: 0,
            unresolvedDisposerCount: 0,
            deadlineAtMs: 100,
            quiescence: 'confirmed',
          },
          6,
          scopeClosed.event.hash,
        ),
      },
    });
    await ledger.append({
      eventId: 'terminal-a',
      kind: 'trajectory.terminal',
      occurredAtMs: 8,
      causalEventIds: ['finalization-receipt'],
      payload: {
        outcome: 'completed',
        summaryDigest: 'e'.repeat(64),
        cleanupOutcome: 'completed',
        quiescence: 'confirmed',
        receiptEventId: 'finalization-receipt',
      },
    });
    expect((await ledger.reconstruct()).length).toBe(8);
  });

  it('rejects ordinary admission that would consume dynamic scope/disposer finalization capacity', async () => {
    const { ledger } = fixture({ maxEvents: 4, maxTotalBytes: 64 * 1024 });
    await ledger.append(opened());
    await expectCode(
      ledger.append({
        eventId: 'scope-a',
        kind: 'scope.opened',
        occurredAtMs: 2,
        causalEventIds: ['event-open'],
        payload: { scopeId: 'scope-a', parentScopeId: null, scopeType: 'test' },
      }),
      'ORDINARY_CAPACITY_EXHAUSTED',
    );
  });

  it('rejects a candidate that would exceed the aggregate byte limit before committing it', async () => {
    const { ledger } = fixture({ maxTotalBytes: 3_500, maxEventBytes: 900 });
    await expectCode(ledger.append(opened()), 'ORDINARY_CAPACITY_EXHAUSTED');
    expect(await ledger.reconstruct()).toEqual([]);
  });

  it('bounds control event references and records', async () => {
    const { ledger } = fixture();
    await ledger.append(opened());
    await expectCode(
      ledger.append({
        ...cancellation('cancel-a', 2),
        causalEventIds: Array.from(
          { length: MAX_CONTROL_CAUSAL_EVENT_IDS + 1 },
          () => 'event-open',
        ),
      }),
      'INVALID_EVENT',
    );
    expect(MAX_CONTROL_EVENT_BYTES).toBeGreaterThan(0);
  });

  it('admits disposer.started when its exact one-event settlement obligation fits', async () => {
    const { ledger } = fixture({ maxEvents: 9, maxTotalBytes: 64 * 1024 });
    const openedEvent = await ledger.append(opened());
    const scope = await ledger.append({
      eventId: 'scope-a',
      kind: 'scope.opened',
      occurredAtMs: 2,
      causalEventIds: [openedEvent.event.eventId],
      payload: { scopeId: 'scope-a', parentScopeId: null, scopeType: 'test' },
    });
    const registered = await ledger.append({
      eventId: 'disposer-a',
      kind: 'disposer.registered',
      occurredAtMs: 3,
      causalEventIds: [scope.event.eventId],
      payload: {
        disposerId: 'disposer-a',
        scopeId: 'scope-a',
        ordinal: 1,
        idempotencyKey: 'disposer-key',
        resourceType: 'test',
        resourceDigest: 'a'.repeat(64),
      },
    });

    await expect(
      ledger.append({
        eventId: 'disposer-start',
        kind: 'disposer.started',
        occurredAtMs: 4,
        causalEventIds: [registered.event.eventId],
        payload: { disposerId: 'disposer-a' },
      }),
    ).resolves.toMatchObject({ status: 'appended' });
  });

  it('rejects a fabricated finalization receipt before it changes the chain', async () => {
    const { ledger } = fixture();
    const openedEvent = await ledger.append(opened());
    const started = await ledger.append({
      eventId: 'finalization-start',
      kind: 'finalization.started',
      occurredAtMs: 2,
      causalEventIds: [openedEvent.event.eventId],
      payload: { reasonCode: 'test', deadlineAtMs: 100 },
    });
    const summary = {
      status: 'complete',
      disposedCount: 0,
      failedDisposerCount: 0,
      timedOutDisposerCount: 0,
      unresolvedOperationCount: 0,
      unresolvedScopeCount: 0,
      unresolvedDisposerCount: 0,
      deadlineAtMs: 100,
      quiescence: 'confirmed',
    } as const;
    await expectCode(
      ledger.append({
        eventId: 'fabricated-receipt',
        kind: 'finalization.receipt',
        occurredAtMs: 3,
        causalEventIds: [started.event.eventId],
        payload: {
          ...summary,
          predecessorSequence: openedEvent.event.sequence,
          predecessorHash: openedEvent.event.hash,
          receiptDigest: receiptDigest(summary, openedEvent.event.sequence, openedEvent.event.hash),
        },
      }),
      'INVALID_EVENT',
    );
    expect((await ledger.reconstruct()).map((event) => event.eventId)).toEqual([
      'event-open',
      'finalization-start',
    ]);
  });

  it('rejects excess/unknown payload keys at append time', async () => {
    const { ledger } = fixture();
    await expectCode(
      ledger.append({
        ...opened(),
        payload: { ...opened().payload, rawPrompt: 'secret' } as never,
      }),
      'INVALID_EVENT',
    );
  });
});

describe('public schema parity', () => {
  it('enumerates exactly the runtime kinds and closes envelope/payload objects', () => {
    const schema = JSON.parse(
      readFileSync(
        new URL('../../../schemas/trajectory-event.v1.schema.json', import.meta.url),
        'utf8',
      ),
    );
    const branches = schema.allOf[0].oneOf as Array<{
      properties: { kind: { const: string } };
    }>;

    expect(branches.map((branch) => branch.properties.kind.const).sort()).toEqual(
      [...EVENT_KINDS].sort(),
    );
    expect(schema.additionalProperties).toBe(false);
    for (const definition of Object.values(schema.$defs) as Array<Record<string, unknown>>) {
      if (definition.type === 'object') expect(definition.additionalProperties).toBe(false);
    }
  });
});
