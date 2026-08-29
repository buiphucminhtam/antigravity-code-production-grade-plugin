import { createHash, randomBytes } from 'node:crypto';
import { constants } from 'node:fs';
import {
  chmod,
  link,
  lstat,
  mkdir,
  open,
  readdir,
  realpath,
  rename,
  unlink,
} from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, join, relative, resolve, sep } from 'node:path';
import { TextDecoder } from 'node:util';

export const TRAJECTORY_EVENT_SCHEMA = 'forgewright-trajectory-event/v1' as const;
const TRAJECTORY_HEAD_SCHEMA = 'forgewright-trajectory-head/v1' as const;

export const EVENT_KINDS = [
  'trajectory.opened',
  'trajectory.recovered',
  'trajectory.terminal',
  'scope.opened',
  'scope.closed',
  'operation.started',
  'operation.settled',
  'disposer.registered',
  'disposer.started',
  'disposer.settled',
  'cancellation.requested',
  'cancellation.acknowledged',
  'finalization.started',
  'finalization.receipt',
] as const;

export type TrajectoryEventKind = (typeof EVENT_KINDS)[number];
export type TrajectoryOutcome = 'completed' | 'failed' | 'cancelled' | 'timed_out';
export type QuiescenceStatus = 'confirmed' | 'not_confirmed';

export interface TrajectoryPayloadMap {
  'trajectory.opened': {
    objectiveDigest: string;
    workspaceId: string;
    sessionId: string;
    origin: string;
    writerEpoch: number;
    rootScopeId: string;
  };
  'trajectory.recovered': {
    checkpointHash: string;
    previousWriterEpoch: number;
    writerEpoch: number;
    reasonCode: string;
  };
  'trajectory.terminal': {
    outcome: TrajectoryOutcome;
    summaryDigest: string;
    cleanupOutcome: 'completed' | 'failed' | 'timed_out';
    quiescence: QuiescenceStatus;
    receiptEventId: string;
  };
  'scope.opened': { scopeId: string; parentScopeId: string | null; scopeType: string };
  'scope.closed': { scopeId: string; outcome: TrajectoryOutcome };
  'operation.started': {
    operationId: string;
    scopeId: string;
    operationType: string;
    inputDigest: string;
  };
  'operation.settled': {
    operationId: string;
    outcome: TrajectoryOutcome;
    outputDigest: string | null;
    errorCode: string | null;
    lateResultDiscarded: boolean;
  };
  'disposer.registered': {
    disposerId: string;
    scopeId: string;
    ordinal: number;
    idempotencyKey: string;
    resourceType: string;
    resourceDigest: string;
  };
  'disposer.started': { disposerId: string };
  'disposer.settled': {
    disposerId: string;
    outcome: TrajectoryOutcome;
    errorCode: string | null;
  };
  'cancellation.requested': { scopeId: string | null; reasonCode: string };
  'cancellation.acknowledged': {
    requestEventId: string;
    scopeId: string;
    observedOperationCount: number;
  };
  'finalization.started': { reasonCode: string; deadlineAtMs: number };
  'finalization.receipt': {
    status: 'complete' | 'partial' | 'failed' | 'timed_out';
    disposedCount: number;
    failedDisposerCount: number;
    timedOutDisposerCount: number;
    unresolvedOperationCount: number;
    unresolvedScopeCount: number;
    unresolvedDisposerCount: number;
    deadlineAtMs: number;
    quiescence: QuiescenceStatus;
    predecessorSequence: number;
    predecessorHash: string;
    receiptDigest: string;
  };
}

export type AppendEventInput = {
  [Kind in TrajectoryEventKind]: {
    eventId: string;
    kind: Kind;
    occurredAtMs: number;
    causalEventIds: string[];
    payload: TrajectoryPayloadMap[Kind];
  };
}[TrajectoryEventKind];

export type TrajectoryEvent = {
  [Kind in TrajectoryEventKind]: {
    schema: typeof TRAJECTORY_EVENT_SCHEMA;
    ledgerId: string;
    sequence: number;
    eventId: string;
    kind: Kind;
    occurredAtMs: number;
    causalEventIds: string[];
    payload: TrajectoryPayloadMap[Kind];
    previousHash: string | null;
    hash: string;
  };
}[TrajectoryEventKind];

export interface LedgerTip {
  sequence: number;
  hash: string | null;
}

export interface AppendResult {
  status: 'appended' | 'idempotent';
  event: TrajectoryEvent;
  tip: LedgerTip;
}

export type TrajectoryLedgerErrorCode =
  | 'INVALID_LEDGER_ID'
  | 'INVALID_EVENT'
  | 'PATH_ESCAPE'
  | 'SYMLINK_REJECTED'
  | 'NON_REGULAR_FILE'
  | 'UNEXPECTED_DIRECTORY_ENTRY'
  | 'EVENT_COUNT_EXCEEDED'
  | 'EVENT_TOO_LARGE'
  | 'LEDGER_TOO_LARGE'
  | 'RECORD_MISSING_NEWLINE'
  | 'MALFORMED_RECORD'
  | 'NON_CANONICAL_RECORD'
  | 'SEQUENCE_GAP'
  | 'CHAIN_CORRUPT'
  | 'HEAD_CORRUPT'
  | 'EXPECTED_TIP_MISMATCH'
  | 'DUPLICATE_EVENT_CONFLICT'
  | 'TRAJECTORY_TERMINAL'
  | 'ORDINARY_CAPACITY_EXHAUSTED'
  | 'FINALIZATION_CAPACITY_EXHAUSTED'
  | 'TOTAL_CAPACITY_EXHAUSTED'
  | 'CONCURRENT_APPEND_EXHAUSTED'
  | 'IO_ERROR';

export type TrajectoryLedgerErrorStatus = 'invalid' | 'conflict' | 'corrupt' | 'capacity' | 'io';

const ERROR_STATUS: Record<TrajectoryLedgerErrorCode, TrajectoryLedgerErrorStatus> = {
  INVALID_LEDGER_ID: 'invalid',
  INVALID_EVENT: 'invalid',
  PATH_ESCAPE: 'invalid',
  SYMLINK_REJECTED: 'corrupt',
  NON_REGULAR_FILE: 'corrupt',
  UNEXPECTED_DIRECTORY_ENTRY: 'corrupt',
  EVENT_COUNT_EXCEEDED: 'capacity',
  EVENT_TOO_LARGE: 'capacity',
  LEDGER_TOO_LARGE: 'capacity',
  RECORD_MISSING_NEWLINE: 'corrupt',
  MALFORMED_RECORD: 'corrupt',
  NON_CANONICAL_RECORD: 'corrupt',
  SEQUENCE_GAP: 'corrupt',
  CHAIN_CORRUPT: 'corrupt',
  HEAD_CORRUPT: 'corrupt',
  EXPECTED_TIP_MISMATCH: 'conflict',
  DUPLICATE_EVENT_CONFLICT: 'conflict',
  TRAJECTORY_TERMINAL: 'conflict',
  ORDINARY_CAPACITY_EXHAUSTED: 'capacity',
  FINALIZATION_CAPACITY_EXHAUSTED: 'capacity',
  TOTAL_CAPACITY_EXHAUSTED: 'capacity',
  CONCURRENT_APPEND_EXHAUSTED: 'conflict',
  IO_ERROR: 'io',
};

export class TrajectoryLedgerError extends Error {
  readonly status: TrajectoryLedgerErrorStatus;
  readonly retryable: boolean;

  constructor(
    readonly code: TrajectoryLedgerErrorCode,
    message: string,
    options: { retryable?: boolean; cause?: unknown } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'TrajectoryLedgerError';
    this.status = ERROR_STATUS[code];
    this.retryable = options.retryable ?? false;
  }
}

function invalid(message: string): never {
  throw new TrajectoryLedgerError('INVALID_EVENT', message);
}

function assertUnicodeScalarString(value: string, label: string): void {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) invalid(`${label} contains an unpaired surrogate`);
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      invalid(`${label} contains an unpaired surrogate`);
    }
  }
}

function canonicalize(value: unknown, seen: Set<object>, depth: number): string {
  if (depth > 64) invalid('canonical JSON depth exceeds 64');
  if (value === null) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'string') {
    assertUnicodeScalarString(value, 'string');
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || Object.is(value, -0)) {
      invalid('canonical JSON numbers must be non-negative-zero safe integers');
    }
    return String(value);
  }
  if (typeof value !== 'object') invalid('canonical JSON contains a non-JSON value');
  if (seen.has(value)) invalid('canonical JSON contains a cycle');
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      return `[${value.map((entry) => canonicalize(entry, seen, depth + 1)).join(',')}]`;
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      invalid('canonical JSON objects must be plain objects');
    }
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => {
        assertUnicodeScalarString(key, 'object key');
        return `${JSON.stringify(key)}:${canonicalize(record[key], seen, depth + 1)}`;
      })
      .join(',')}}`;
  } finally {
    seen.delete(value);
  }
}

/** Canonical UTF-8 JSON text over null/boolean/string/safe-integer/array/plain-object values. */
export function canonicalJson(value: unknown): string {
  return canonicalize(value, new Set(), 0);
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function assertExactKeys(
  value: unknown,
  required: readonly string[],
  label: string,
): asserts value is Record<string, unknown> {
  if (!isRecord(value)) invalid(`${label} must be an object`);
  const keys = Object.keys(value).sort();
  const expected = [...required].sort();
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
    invalid(`${label} has unknown or missing keys`);
  }
}

const OPAQUE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const LEDGER_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const DIGEST = /^[0-9a-f]{64}$/;

function assertOpaqueId(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !OPAQUE_ID.test(value)) invalid(`${label} is invalid`);
}

function assertCode(value: unknown, label: string): asserts value is string {
  if (
    typeof value !== 'string' ||
    value.length < 1 ||
    value.length > 128 ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value)
  ) {
    invalid(`${label} is invalid`);
  }
}

function assertDigest(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !DIGEST.test(value)) invalid(`${label} must be SHA-256 hex`);
}

function assertOutcome(value: unknown, label: string): asserts value is TrajectoryOutcome {
  if (
    value !== 'completed' &&
    value !== 'failed' &&
    value !== 'cancelled' &&
    value !== 'timed_out'
  ) {
    invalid(`${label} is invalid`);
  }
}

function assertSafeCount(value: unknown, label: string): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) invalid(`${label} is invalid`);
}

function validatePayload(kind: TrajectoryEventKind, payload: unknown): void {
  switch (kind) {
    case 'trajectory.opened':
      assertExactKeys(
        payload,
        ['objectiveDigest', 'workspaceId', 'sessionId', 'origin', 'writerEpoch', 'rootScopeId'],
        kind,
      );
      assertDigest(payload.objectiveDigest, 'objectiveDigest');
      assertOpaqueId(payload.workspaceId, 'workspaceId');
      assertOpaqueId(payload.sessionId, 'sessionId');
      assertCode(payload.origin, 'origin');
      assertSafeCount(payload.writerEpoch, 'writerEpoch');
      assertOpaqueId(payload.rootScopeId, 'rootScopeId');
      break;
    case 'trajectory.recovered':
      assertExactKeys(
        payload,
        ['checkpointHash', 'previousWriterEpoch', 'writerEpoch', 'reasonCode'],
        kind,
      );
      assertDigest(payload.checkpointHash, 'checkpointHash');
      assertSafeCount(payload.previousWriterEpoch, 'previousWriterEpoch');
      assertSafeCount(payload.writerEpoch, 'writerEpoch');
      assertCode(payload.reasonCode, 'reasonCode');
      break;
    case 'trajectory.terminal':
      assertExactKeys(
        payload,
        ['outcome', 'summaryDigest', 'cleanupOutcome', 'quiescence', 'receiptEventId'],
        kind,
      );
      assertOutcome(payload.outcome, 'outcome');
      assertDigest(payload.summaryDigest, 'summaryDigest');
      if (
        payload.cleanupOutcome !== 'completed' &&
        payload.cleanupOutcome !== 'failed' &&
        payload.cleanupOutcome !== 'timed_out'
      ) {
        invalid('cleanupOutcome is invalid');
      }
      if (payload.quiescence !== 'confirmed' && payload.quiescence !== 'not_confirmed') {
        invalid('quiescence is invalid');
      }
      assertOpaqueId(payload.receiptEventId, 'receiptEventId');
      break;
    case 'scope.opened':
      assertExactKeys(payload, ['scopeId', 'parentScopeId', 'scopeType'], kind);
      assertOpaqueId(payload.scopeId, 'scopeId');
      if (payload.parentScopeId !== null) assertOpaqueId(payload.parentScopeId, 'parentScopeId');
      assertCode(payload.scopeType, 'scopeType');
      break;
    case 'scope.closed':
      assertExactKeys(payload, ['scopeId', 'outcome'], kind);
      assertOpaqueId(payload.scopeId, 'scopeId');
      assertOutcome(payload.outcome, 'outcome');
      break;
    case 'operation.started':
      assertExactKeys(payload, ['operationId', 'scopeId', 'operationType', 'inputDigest'], kind);
      assertOpaqueId(payload.operationId, 'operationId');
      assertOpaqueId(payload.scopeId, 'scopeId');
      assertCode(payload.operationType, 'operationType');
      assertDigest(payload.inputDigest, 'inputDigest');
      break;
    case 'operation.settled':
      assertExactKeys(
        payload,
        ['operationId', 'outcome', 'outputDigest', 'errorCode', 'lateResultDiscarded'],
        kind,
      );
      assertOpaqueId(payload.operationId, 'operationId');
      assertOutcome(payload.outcome, 'outcome');
      if (payload.outputDigest !== null) assertDigest(payload.outputDigest, 'outputDigest');
      if (payload.errorCode !== null) assertCode(payload.errorCode, 'errorCode');
      if (typeof payload.lateResultDiscarded !== 'boolean') {
        invalid('lateResultDiscarded must be boolean');
      }
      break;
    case 'disposer.registered':
      assertExactKeys(
        payload,
        ['disposerId', 'scopeId', 'ordinal', 'idempotencyKey', 'resourceType', 'resourceDigest'],
        kind,
      );
      assertOpaqueId(payload.disposerId, 'disposerId');
      assertOpaqueId(payload.scopeId, 'scopeId');
      assertSafeCount(payload.ordinal, 'ordinal');
      if (payload.ordinal < 1) invalid('ordinal must be positive');
      assertOpaqueId(payload.idempotencyKey, 'idempotencyKey');
      assertCode(payload.resourceType, 'resourceType');
      assertDigest(payload.resourceDigest, 'resourceDigest');
      break;
    case 'disposer.started':
      assertExactKeys(payload, ['disposerId'], kind);
      assertOpaqueId(payload.disposerId, 'disposerId');
      break;
    case 'disposer.settled':
      assertExactKeys(payload, ['disposerId', 'outcome', 'errorCode'], kind);
      assertOpaqueId(payload.disposerId, 'disposerId');
      assertOutcome(payload.outcome, 'outcome');
      if (payload.errorCode !== null) assertCode(payload.errorCode, 'errorCode');
      break;
    case 'cancellation.requested':
      assertExactKeys(payload, ['scopeId', 'reasonCode'], kind);
      if (payload.scopeId !== null) assertOpaqueId(payload.scopeId, 'scopeId');
      assertCode(payload.reasonCode, 'reasonCode');
      break;
    case 'cancellation.acknowledged':
      assertExactKeys(payload, ['requestEventId', 'scopeId', 'observedOperationCount'], kind);
      assertOpaqueId(payload.requestEventId, 'requestEventId');
      assertOpaqueId(payload.scopeId, 'scopeId');
      assertSafeCount(payload.observedOperationCount, 'observedOperationCount');
      break;
    case 'finalization.started':
      assertExactKeys(payload, ['reasonCode', 'deadlineAtMs'], kind);
      assertCode(payload.reasonCode, 'reasonCode');
      assertSafeCount(payload.deadlineAtMs, 'deadlineAtMs');
      break;
    case 'finalization.receipt':
      assertExactKeys(
        payload,
        [
          'status',
          'disposedCount',
          'failedDisposerCount',
          'timedOutDisposerCount',
          'unresolvedOperationCount',
          'unresolvedScopeCount',
          'unresolvedDisposerCount',
          'deadlineAtMs',
          'quiescence',
          'predecessorSequence',
          'predecessorHash',
          'receiptDigest',
        ],
        kind,
      );
      if (
        payload.status !== 'complete' &&
        payload.status !== 'partial' &&
        payload.status !== 'failed' &&
        payload.status !== 'timed_out'
      ) {
        invalid('finalization receipt status is invalid');
      }
      assertSafeCount(payload.disposedCount, 'disposedCount');
      assertSafeCount(payload.failedDisposerCount, 'failedDisposerCount');
      assertSafeCount(payload.timedOutDisposerCount, 'timedOutDisposerCount');
      assertSafeCount(payload.unresolvedOperationCount, 'unresolvedOperationCount');
      assertSafeCount(payload.unresolvedScopeCount, 'unresolvedScopeCount');
      assertSafeCount(payload.unresolvedDisposerCount, 'unresolvedDisposerCount');
      assertSafeCount(payload.deadlineAtMs, 'deadlineAtMs');
      if (payload.quiescence !== 'confirmed' && payload.quiescence !== 'not_confirmed') {
        invalid('quiescence is invalid');
      }
      assertSafeCount(payload.predecessorSequence, 'predecessorSequence');
      if (payload.predecessorSequence < 1) invalid('predecessorSequence must be positive');
      assertDigest(payload.predecessorHash, 'predecessorHash');
      assertDigest(payload.receiptDigest, 'receiptDigest');
      break;
  }
}

function validateInput(input: unknown): asserts input is AppendEventInput {
  assertExactKeys(
    input,
    ['eventId', 'kind', 'occurredAtMs', 'causalEventIds', 'payload'],
    'event input',
  );
  assertOpaqueId(input.eventId, 'eventId');
  if (!(EVENT_KINDS as readonly unknown[]).includes(input.kind)) invalid('event kind is unknown');
  assertSafeCount(input.occurredAtMs, 'occurredAtMs');
  if (!Array.isArray(input.causalEventIds) || input.causalEventIds.length > 128) {
    invalid('causalEventIds is invalid');
  }
  const causalIds = new Set<string>();
  for (const causalId of input.causalEventIds) {
    assertOpaqueId(causalId, 'causalEventId');
    if (causalIds.has(causalId)) invalid('causalEventIds contains a duplicate');
    causalIds.add(causalId);
  }
  if (
    CONTROL_KINDS.has(input.kind as TrajectoryEventKind) &&
    input.causalEventIds.length > MAX_CONTROL_CAUSAL_EVENT_IDS
  ) {
    invalid('control event has too many causal references');
  }
  validatePayload(input.kind as TrajectoryEventKind, input.payload);
  canonicalJson(input);
}

function eventHash(event: Omit<TrajectoryEvent, 'hash'>): string {
  return sha256(canonicalJson(event));
}

function semanticInput(event: TrajectoryEvent): AppendEventInput {
  return {
    eventId: event.eventId,
    kind: event.kind,
    occurredAtMs: event.occurredAtMs,
    causalEventIds: [...event.causalEventIds],
    payload: structuredClone(event.payload),
  } as AppendEventInput;
}

function sameInput(left: AppendEventInput, right: AppendEventInput): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

function tipOf(events: readonly TrajectoryEvent[]): LedgerTip {
  const event = events.at(-1);
  return event === undefined
    ? { sequence: 0, hash: null }
    : { sequence: event.sequence, hash: event.hash };
}

function tipsEqual(left: LedgerTip, right: LedgerTip): boolean {
  return left.sequence === right.sequence && left.hash === right.hash;
}

function validateRecoveryEpoch(
  payload: TrajectoryPayloadMap['trajectory.recovered'],
  priorEvents: readonly TrajectoryEvent[],
): void {
  const previousWriterEpoch = foldTrajectory(priorEvents).latestWriterEpoch;
  if (
    previousWriterEpoch === null ||
    payload.previousWriterEpoch !== previousWriterEpoch ||
    payload.writerEpoch !== previousWriterEpoch + 1
  ) {
    invalid('trajectory recovery writer epoch is not the next epoch');
  }
}

function futureControlObligations(events: readonly TrajectoryEvent[]): number {
  const scopes = new Set<string>();
  const operations = new Set<string>();
  const disposers = new Map<string, 'registered' | 'started'>();
  const pendingCancellations = new Set<string>();
  let finalizationStarted = false;
  let finalizationReceipt = false;
  let terminal = false;
  for (const event of events) {
    switch (event.kind) {
      case 'scope.opened':
        scopes.add(event.payload.scopeId);
        break;
      case 'scope.closed':
        scopes.delete(event.payload.scopeId);
        break;
      case 'operation.started':
        operations.add(event.payload.operationId);
        break;
      case 'operation.settled':
        operations.delete(event.payload.operationId);
        break;
      case 'disposer.registered':
        disposers.set(event.payload.disposerId, 'registered');
        break;
      case 'disposer.started':
        disposers.set(event.payload.disposerId, 'started');
        break;
      case 'disposer.settled':
        disposers.delete(event.payload.disposerId);
        break;
      case 'cancellation.requested':
        pendingCancellations.add(event.eventId);
        break;
      case 'cancellation.acknowledged':
        pendingCancellations.delete(event.payload.requestEventId);
        break;
      case 'finalization.started':
        finalizationStarted = true;
        break;
      case 'finalization.receipt':
        finalizationReceipt = true;
        break;
      case 'trajectory.terminal':
        terminal = true;
        break;
      case 'trajectory.opened':
      case 'trajectory.recovered':
    }
  }
  if (terminal) return 0;
  return (
    scopes.size +
    operations.size +
    [...disposers.values()].reduce((total, state) => total + (state === 'registered' ? 2 : 1), 0) +
    pendingCancellations.size +
    (finalizationStarted ? 0 : 1) +
    (finalizationReceipt ? 0 : 1) +
    1
  );
}

function validateFinalizationReceiptBinding(
  payload: TrajectoryPayloadMap['finalization.receipt'],
  predecessorTip: LedgerTip,
): void {
  if (
    predecessorTip.hash === null ||
    payload.predecessorSequence !== predecessorTip.sequence ||
    payload.predecessorHash !== predecessorTip.hash
  ) {
    invalid('finalization receipt predecessor does not bind the immediate prior event');
  }
  const { receiptDigest, predecessorSequence, predecessorHash, ...summary } = payload;
  const expectedReceiptDigest = sha256(
    canonicalJson({
      ...summary,
      predecessorTip: { sequence: predecessorSequence, hash: predecessorHash },
    }),
  );
  if (receiptDigest !== expectedReceiptDigest) invalid('finalization receipt digest mismatch');
}

function ledgerFailure(
  code: TrajectoryLedgerErrorCode,
  message: string,
  cause?: unknown,
): TrajectoryLedgerError {
  return new TrajectoryLedgerError(code, message, { cause });
}

function isNodeError(error: unknown, code: string): boolean {
  return isRecord(error) && error.code === code;
}

const EVENT_FILE = /^(\d{20})\.event\.json$/;
const HEAD_FILE = 'HEAD.json';
const UTF8_DECODER = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
const CONTROL_KINDS = new Set<TrajectoryEventKind>([
  'trajectory.recovered',
  'scope.closed',
  'operation.settled',
  'disposer.started',
  'disposer.settled',
  'cancellation.requested',
  'cancellation.acknowledged',
  'finalization.started',
  'finalization.receipt',
  'trajectory.terminal',
]);
export const MAX_CONTROL_CAUSAL_EVENT_IDS = 1;
export const MAX_CONTROL_EVENT_BYTES = 4 * 1024;

interface TrajectoryHead {
  schema: typeof TRAJECTORY_HEAD_SCHEMA;
  ledgerId: string;
  sequence: number;
  hash: string | null;
}

export interface TrajectoryLedgerOptions {
  root?: string;
  ledgerId: string;
  maxEvents?: number;
  maxEventBytes?: number;
  maxTotalBytes?: number;
  maxDirectoryEntries?: number;
  finalizationReserve?: number;
  maxAppendRetries?: number;
}

export interface TrajectoryFold {
  opened: boolean;
  recoveredCount: number;
  latestWriterEpoch: number | null;
  terminal: TrajectoryOutcome | null;
  openScopeIds: string[];
  activeOperationIds: string[];
  pendingDisposerIds: string[];
  cancellationRequested: boolean;
  cancellationAcknowledged: boolean;
  finalizationStarted: boolean;
  finalizationReceiptCount: number;
}

export function foldTrajectory(events: readonly TrajectoryEvent[]): TrajectoryFold {
  let opened = false;
  let recoveredCount = 0;
  let latestWriterEpoch: number | null = null;
  let terminal: TrajectoryOutcome | null = null;
  const scopes = new Set<string>();
  const operations = new Set<string>();
  const disposers = new Set<string>();
  let cancellationRequested = false;
  let cancellationAcknowledged = false;
  let finalizationStarted = false;
  let finalizationReceiptCount = 0;

  for (const event of events) {
    switch (event.kind) {
      case 'trajectory.opened':
        opened = true;
        latestWriterEpoch = event.payload.writerEpoch;
        break;
      case 'trajectory.recovered':
        recoveredCount += 1;
        latestWriterEpoch = event.payload.writerEpoch;
        break;
      case 'trajectory.terminal':
        terminal = event.payload.outcome;
        break;
      case 'scope.opened':
        scopes.add(event.payload.scopeId);
        break;
      case 'scope.closed':
        scopes.delete(event.payload.scopeId);
        break;
      case 'operation.started':
        operations.add(event.payload.operationId);
        break;
      case 'operation.settled':
        operations.delete(event.payload.operationId);
        break;
      case 'disposer.registered':
        disposers.add(event.payload.disposerId);
        break;
      case 'disposer.settled':
        disposers.delete(event.payload.disposerId);
        break;
      case 'cancellation.requested':
        cancellationRequested = true;
        break;
      case 'cancellation.acknowledged':
        cancellationAcknowledged = true;
        break;
      case 'finalization.started':
        finalizationStarted = true;
        break;
      case 'finalization.receipt':
        finalizationReceiptCount += 1;
        break;
      case 'disposer.started':
        break;
    }
  }

  return {
    opened,
    recoveredCount,
    latestWriterEpoch,
    terminal,
    openScopeIds: [...scopes].sort(),
    activeOperationIds: [...operations].sort(),
    pendingDisposerIds: [...disposers].sort(),
    cancellationRequested,
    cancellationAcknowledged,
    finalizationStarted,
    finalizationReceiptCount,
  };
}

export class TrajectoryLedger {
  root: string;
  readonly ledgerId: string;
  directory: string;
  private readonly configuredRoot: string;
  private readonly maxEvents: number;
  private readonly maxEventBytes: number;
  private readonly maxTotalBytes: number;
  private readonly maxDirectoryEntries: number;
  private readonly finalizationReserve: number;
  private readonly maxAppendRetries: number;

  constructor(options: TrajectoryLedgerOptions) {
    if (
      !LEDGER_ID.test(options.ledgerId) ||
      options.ledgerId === '.' ||
      options.ledgerId === '..'
    ) {
      throw new TrajectoryLedgerError('INVALID_LEDGER_ID', 'ledgerId is invalid');
    }
    this.root = resolve(
      options.root ?? join(homedir(), '.forgewright', 'runtime', 'trajectory-ledgers'),
    );
    this.configuredRoot = this.root;
    this.ledgerId = options.ledgerId;
    this.directory = resolve(this.root, this.ledgerId);
    const pathFromRoot = relative(this.root, this.directory);
    if (!pathFromRoot || pathFromRoot.startsWith(`..${sep}`) || pathFromRoot === '..') {
      throw new TrajectoryLedgerError('PATH_ESCAPE', 'trajectory directory escapes its root');
    }

    this.maxEvents = options.maxEvents ?? 10_000;
    this.maxEventBytes = options.maxEventBytes ?? 256 * 1024;
    this.maxTotalBytes = options.maxTotalBytes ?? 64 * 1024 * 1024;
    this.finalizationReserve = options.finalizationReserve ?? Math.min(1_024, this.maxEvents - 1);
    this.maxDirectoryEntries = options.maxDirectoryEntries ?? this.maxEvents + 1_024;
    this.maxAppendRetries = options.maxAppendRetries ?? 32;
    for (const [name, value] of Object.entries({
      maxEvents: this.maxEvents,
      maxEventBytes: this.maxEventBytes,
      maxTotalBytes: this.maxTotalBytes,
      maxDirectoryEntries: this.maxDirectoryEntries,
      finalizationReserve: this.finalizationReserve,
      maxAppendRetries: this.maxAppendRetries,
    })) {
      if (!Number.isSafeInteger(value) || value < 1) {
        throw new TrajectoryLedgerError('INVALID_EVENT', `${name} must be a positive safe integer`);
      }
    }
    if (this.finalizationReserve >= this.maxEvents) {
      throw new TrajectoryLedgerError(
        'INVALID_EVENT',
        'finalizationReserve must leave capacity for ordinary events',
      );
    }
  }

  async append(input: AppendEventInput, expectedTip?: LedgerTip | null): Promise<AppendResult> {
    validateInput(input);
    const normalizedExpected = expectedTip === null ? { sequence: 0, hash: null } : expectedTip;
    if (normalizedExpected !== undefined) this.validateTip(normalizedExpected);

    for (let attempt = 0; attempt < this.maxAppendRetries; attempt += 1) {
      const events = await this.reconstruct();
      const currentTip = tipOf(events);
      const duplicate = events.find((event) => event.eventId === input.eventId);
      if (duplicate !== undefined) {
        if (!sameInput(semanticInput(duplicate), input)) {
          throw ledgerFailure(
            'DUPLICATE_EVENT_CONFLICT',
            `eventId ${input.eventId} already has different content`,
          );
        }
        return { status: 'idempotent', event: duplicate, tip: currentTip };
      }
      if (normalizedExpected !== undefined && !tipsEqual(normalizedExpected, currentTip)) {
        throw ledgerFailure(
          'EXPECTED_TIP_MISMATCH',
          `expected tip ${normalizedExpected.sequence} does not match ${currentTip.sequence}`,
        );
      }
      if (events.some((event) => event.kind === 'trajectory.terminal')) {
        throw ledgerFailure('TRAJECTORY_TERMINAL', 'trajectory is terminal');
      }
      if (
        (events.length === 0 && input.kind !== 'trajectory.opened') ||
        (events.length > 0 && input.kind === 'trajectory.opened')
      ) {
        throw ledgerFailure(
          'INVALID_EVENT',
          'trajectory.opened must occur exactly once at sequence one',
        );
      }
      const knownIds = new Set(events.map((event) => event.eventId));
      for (const causalId of input.causalEventIds) {
        if (!knownIds.has(causalId)) {
          throw ledgerFailure(
            'INVALID_EVENT',
            `causal event ${causalId} is not earlier in the chain`,
          );
        }
      }
      if (input.kind === 'trajectory.recovered') {
        validateRecoveryEpoch(input.payload, events);
      }
      if (input.kind === 'finalization.receipt') {
        validateFinalizationReceiptBinding(input.payload, currentTip);
      }
      const body = {
        schema: TRAJECTORY_EVENT_SCHEMA,
        ledgerId: this.ledgerId,
        sequence: currentTip.sequence + 1,
        eventId: input.eventId,
        kind: input.kind,
        occurredAtMs: input.occurredAtMs,
        causalEventIds: [...input.causalEventIds],
        payload: structuredClone(input.payload),
        previousHash: currentTip.hash,
      } as Omit<TrajectoryEvent, 'hash'>;
      const event = { ...body, hash: eventHash(body) } as TrajectoryEvent;
      const encoded = Buffer.from(`${canonicalJson(event)}\n`, 'utf8');
      if (encoded.byteLength > this.maxEventBytes) {
        throw ledgerFailure('EVENT_TOO_LARGE', 'encoded event exceeds maxEventBytes');
      }
      if (CONTROL_KINDS.has(input.kind) && encoded.byteLength > MAX_CONTROL_EVENT_BYTES) {
        throw ledgerFailure('EVENT_TOO_LARGE', 'control event exceeds MAX_CONTROL_EVENT_BYTES');
      }
      this.assertCapacity(events, event, encoded.byteLength);
      const committed = await this.commitEvent(event.sequence, encoded);
      if (!committed) {
        if (normalizedExpected !== undefined) {
          throw ledgerFailure('EXPECTED_TIP_MISMATCH', 'tip changed during append', undefined);
        }
        continue;
      }
      const nextTip = { sequence: event.sequence, hash: event.hash };
      await this.writeHead(nextTip);
      return { status: 'appended', event, tip: nextTip };
    }
    throw new TrajectoryLedgerError(
      'CONCURRENT_APPEND_EXHAUSTED',
      'append retry budget exhausted',
      { retryable: true },
    );
  }

  async reconstruct(): Promise<readonly TrajectoryEvent[]> {
    await this.ensureDirectory();
    const entries = await readdir(this.directory, { withFileTypes: true });
    if (entries.length > this.maxDirectoryEntries) {
      throw ledgerFailure('EVENT_COUNT_EXCEEDED', 'trajectory directory entry limit exceeded');
    }

    const eventNames: string[] = [];
    for (const entry of entries) {
      if (entry.isSymbolicLink()) {
        throw ledgerFailure('SYMLINK_REJECTED', `symlink entry rejected: ${entry.name}`);
      }
      if (EVENT_FILE.test(entry.name)) {
        if (!entry.isFile()) {
          throw ledgerFailure('NON_REGULAR_FILE', `event is not regular: ${entry.name}`);
        }
        eventNames.push(entry.name);
      } else if (
        entry.name !== HEAD_FILE &&
        !entry.name.startsWith('.event.tmp-') &&
        !entry.name.startsWith('.head.tmp-')
      ) {
        throw ledgerFailure('UNEXPECTED_DIRECTORY_ENTRY', `unexpected entry: ${entry.name}`);
      } else if (!entry.isFile()) {
        throw ledgerFailure('NON_REGULAR_FILE', `ledger metadata is not regular: ${entry.name}`);
      }
    }
    if (eventNames.length > this.maxEvents) {
      throw ledgerFailure('EVENT_COUNT_EXCEEDED', 'event count exceeds maxEvents');
    }
    eventNames.sort();

    let totalBytes = 0;
    const sizes = new Map<string, number>();
    for (const name of eventNames) {
      const metadata = await lstat(join(this.directory, name));
      if (metadata.isSymbolicLink()) throw ledgerFailure('SYMLINK_REJECTED', name);
      if (!metadata.isFile()) throw ledgerFailure('NON_REGULAR_FILE', name);
      if (metadata.size > this.maxEventBytes) {
        throw ledgerFailure('EVENT_TOO_LARGE', `${name} exceeds maxEventBytes`);
      }
      totalBytes += metadata.size;
      if (totalBytes > this.maxTotalBytes) {
        throw ledgerFailure('LEDGER_TOO_LARGE', 'ledger exceeds maxTotalBytes');
      }
      sizes.set(name, metadata.size);
    }

    const events: TrajectoryEvent[] = [];
    let previousHash: string | null = null;
    let terminalSeen = false;
    for (let index = 0; index < eventNames.length; index += 1) {
      const name = eventNames[index];
      const expectedSequence = index + 1;
      const fileSequence = Number(EVENT_FILE.exec(name)?.[1]);
      if (fileSequence !== expectedSequence) {
        throw ledgerFailure('SEQUENCE_GAP', `expected sequence ${expectedSequence}, found ${name}`);
      }
      const raw = await this.readRegularFile(join(this.directory, name), sizes.get(name));
      if (!raw.endsWith('\n')) {
        throw ledgerFailure('RECORD_MISSING_NEWLINE', `${name} has no final newline`);
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw.slice(0, -1));
      } catch (error) {
        throw ledgerFailure('MALFORMED_RECORD', `${name} is not JSON`, error);
      }
      let canonical: string;
      try {
        canonical = `${canonicalJson(parsed)}\n`;
      } catch (error) {
        throw ledgerFailure('CHAIN_CORRUPT', `${name} is outside the canonical subset`, error);
      }
      if (canonical !== raw) {
        throw ledgerFailure('NON_CANONICAL_RECORD', `${name} is not canonical JSON`);
      }
      const event = this.decodeEvent(parsed, expectedSequence, previousHash, events);
      if (
        (expectedSequence === 1 && event.kind !== 'trajectory.opened') ||
        (expectedSequence > 1 && event.kind === 'trajectory.opened')
      ) {
        throw ledgerFailure(
          'CHAIN_CORRUPT',
          'trajectory.opened must occur exactly once at sequence one',
        );
      }
      if (terminalSeen) {
        throw ledgerFailure('CHAIN_CORRUPT', 'event appears after trajectory.terminal');
      }
      terminalSeen = event.kind === 'trajectory.terminal';
      events.push(event);
      previousHash = event.hash;
    }
    await this.reconcileHead(events);
    return events;
  }

  async tip(): Promise<LedgerTip> {
    return tipOf(await this.reconstruct());
  }

  private validateTip(tip: LedgerTip): void {
    assertExactKeys(tip, ['sequence', 'hash'], 'expectedTip');
    assertSafeCount(tip.sequence, 'expectedTip.sequence');
    if ((tip.sequence === 0) !== (tip.hash === null)) invalid('expectedTip is inconsistent');
    if (tip.hash !== null) assertDigest(tip.hash, 'expectedTip.hash');
  }

  private assertCapacity(
    events: readonly TrajectoryEvent[],
    candidate: TrajectoryEvent,
    candidateBytes: number,
  ): void {
    if (events.length >= this.maxEvents) {
      throw ledgerFailure('TOTAL_CAPACITY_EXHAUSTED', 'total event capacity exhausted');
    }
    const existingBytes = events.reduce(
      (total, event) => total + Buffer.byteLength(`${canonicalJson(event)}\n`, 'utf8'),
      0,
    );
    if (existingBytes + candidateBytes > this.maxTotalBytes) {
      throw ledgerFailure('LEDGER_TOO_LARGE', 'candidate event exceeds maxTotalBytes');
    }
    const futureControls = futureControlObligations([...events, candidate]);
    const remainingSlots = this.maxEvents - events.length - 1;
    const reservedControlBytes = futureControls * MAX_CONTROL_EVENT_BYTES;
    const remainingBytes = this.maxTotalBytes - existingBytes - candidateBytes;
    if (remainingSlots < futureControls || remainingBytes < reservedControlBytes) {
      throw ledgerFailure(
        CONTROL_KINDS.has(candidate.kind)
          ? 'FINALIZATION_CAPACITY_EXHAUSTED'
          : 'ORDINARY_CAPACITY_EXHAUSTED',
        'candidate would consume required finalization capacity',
      );
    }
  }

  private decodeEvent(
    value: unknown,
    sequence: number,
    previousHash: string | null,
    earlierEvents: readonly TrajectoryEvent[],
  ): TrajectoryEvent {
    try {
      assertExactKeys(
        value,
        [
          'schema',
          'ledgerId',
          'sequence',
          'eventId',
          'kind',
          'occurredAtMs',
          'causalEventIds',
          'payload',
          'previousHash',
          'hash',
        ],
        'persisted event',
      );
      validateInput({
        eventId: value.eventId,
        kind: value.kind,
        occurredAtMs: value.occurredAtMs,
        causalEventIds: value.causalEventIds,
        payload: value.payload,
      });
      if (value.schema !== TRAJECTORY_EVENT_SCHEMA || value.ledgerId !== this.ledgerId) {
        throw invalid('persisted schema or ledgerId mismatch');
      }
      if (value.sequence !== sequence || value.previousHash !== previousHash) {
        throw invalid('persisted sequence or previousHash mismatch');
      }
      if (value.kind === 'finalization.receipt') {
        validateFinalizationReceiptBinding(
          value.payload as TrajectoryPayloadMap['finalization.receipt'],
          {
            sequence: sequence - 1,
            hash: previousHash,
          },
        );
      }
      if (value.kind === 'trajectory.recovered') {
        validateRecoveryEpoch(
          value.payload as TrajectoryPayloadMap['trajectory.recovered'],
          earlierEvents,
        );
      }
      assertDigest(value.hash, 'hash');
      const earlierIds = new Set(earlierEvents.map((event) => event.eventId));
      if (earlierIds.has(value.eventId as string)) throw invalid('duplicate eventId');
      for (const causalId of value.causalEventIds as string[]) {
        if (!earlierIds.has(causalId)) throw invalid('causal reference is not earlier');
      }
      const { hash, ...body } = value;
      if (eventHash(body as Omit<TrajectoryEvent, 'hash'>) !== hash) {
        throw invalid('event hash mismatch');
      }
      return value as TrajectoryEvent;
    } catch (error) {
      if (error instanceof TrajectoryLedgerError && error.code === 'CHAIN_CORRUPT') throw error;
      throw ledgerFailure(
        'CHAIN_CORRUPT',
        `chain validation failed at sequence ${sequence}`,
        error,
      );
    }
  }

  private async ensureDirectory(): Promise<void> {
    try {
      await this.assertNoConfiguredRootSuffixSymlink();
      await mkdir(this.root, { recursive: true, mode: 0o700 });
      this.root = await realpath(this.root);
      this.directory = resolve(this.root, this.ledgerId);
      await this.assertDirectory(this.root);
      try {
        await mkdir(this.directory, { mode: 0o700 });
      } catch (error) {
        if (!isNodeError(error, 'EEXIST')) throw error;
      }
      await this.assertDirectory(this.directory);
      await chmod(this.directory, 0o700);
    } catch (error) {
      if (error instanceof TrajectoryLedgerError) throw error;
      throw ledgerFailure('IO_ERROR', 'unable to prepare trajectory directory', error);
    }
  }

  private async assertDirectory(path: string): Promise<void> {
    const metadata = await lstat(path);
    if (metadata.isSymbolicLink()) throw ledgerFailure('SYMLINK_REJECTED', `${path} is a symlink`);
    if (!metadata.isDirectory())
      throw ledgerFailure('NON_REGULAR_FILE', `${path} is not a directory`);
  }

  private async assertNoConfiguredRootSuffixSymlink(): Promise<void> {
    let anchor = this.configuredRoot;
    let foundDirectory = false;
    while (!foundDirectory) {
      try {
        const metadata = await lstat(anchor);
        if (metadata.isDirectory() && !metadata.isSymbolicLink()) {
          foundDirectory = true;
          continue;
        }
      } catch (error) {
        if (!isNodeError(error, 'ENOENT')) throw error;
      }
      const parent = join(anchor, '..');
      if (resolve(parent) === anchor) return;
      anchor = resolve(parent);
    }
    const suffix = relative(anchor, this.configuredRoot);
    if (!suffix) return;
    let current = anchor;
    for (const segment of suffix.split(sep)) {
      current = join(current, segment);
      try {
        if ((await lstat(current)).isSymbolicLink()) {
          throw ledgerFailure('SYMLINK_REJECTED', `${current} is a symlink`);
        }
      } catch (error) {
        if (!isNodeError(error, 'ENOENT')) throw error;
      }
    }
  }

  private eventPath(sequence: number): string {
    return join(this.directory, `${String(sequence).padStart(20, '0')}.event.json`);
  }

  private async commitEvent(sequence: number, encoded: Buffer): Promise<boolean> {
    await this.ensureDirectory();
    const temporary = join(
      this.directory,
      `.event.tmp-${process.pid}-${randomBytes(16).toString('hex')}`,
    );
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      handle = await open(temporary, 'wx', 0o600);
      await handle.writeFile(encoded);
      await handle.sync();
      await handle.close();
      handle = undefined;
      try {
        await link(temporary, this.eventPath(sequence));
      } catch (error) {
        if (isNodeError(error, 'EEXIST')) return false;
        throw error;
      }
      await unlink(temporary);
      await this.syncDirectory();
      return true;
    } catch (error) {
      if (error instanceof TrajectoryLedgerError) throw error;
      throw ledgerFailure('IO_ERROR', 'event commit failed', error);
    } finally {
      await handle?.close().catch(() => undefined);
      await unlink(temporary).catch(() => undefined);
    }
  }

  private async readRegularFile(path: string, expectedSize?: number): Promise<string> {
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
      const metadata = await handle.stat();
      if (!metadata.isFile())
        throw ledgerFailure('NON_REGULAR_FILE', `${basename(path)} is not regular`);
      if (expectedSize !== undefined && metadata.size !== expectedSize) {
        throw ledgerFailure('CHAIN_CORRUPT', `${basename(path)} changed during reconstruction`);
      }
      if (metadata.size > this.maxEventBytes) {
        throw ledgerFailure('EVENT_TOO_LARGE', `${basename(path)} exceeds maxEventBytes`);
      }
      const bytes = await handle.readFile();
      if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
        throw ledgerFailure('MALFORMED_RECORD', `${basename(path)} has a UTF-8 BOM`);
      }
      try {
        return UTF8_DECODER.decode(bytes);
      } catch (error) {
        throw ledgerFailure('MALFORMED_RECORD', `${basename(path)} is not UTF-8`, error);
      }
    } catch (error) {
      if (isNodeError(error, 'ELOOP')) {
        throw ledgerFailure('SYMLINK_REJECTED', `${basename(path)} is a symlink`, error);
      }
      if (error instanceof TrajectoryLedgerError) throw error;
      throw ledgerFailure('IO_ERROR', `unable to read ${basename(path)}`, error);
    } finally {
      await handle?.close().catch(() => undefined);
    }
  }

  private async reconcileHead(events: readonly TrajectoryEvent[]): Promise<void> {
    const current = tipOf(events);
    const path = join(this.directory, HEAD_FILE);
    let raw: string;
    try {
      raw = await this.readRegularFile(path);
    } catch (error) {
      if (error instanceof TrajectoryLedgerError && error.code === 'IO_ERROR') {
        const cause = error.cause;
        if (isNodeError(cause, 'ENOENT')) {
          await this.writeHead(current);
          return;
        }
      }
      if (error instanceof TrajectoryLedgerError && error.code === 'MALFORMED_RECORD') {
        throw ledgerFailure('HEAD_CORRUPT', 'advisory head is not UTF-8', error);
      }
      throw error;
    }
    let parsed: unknown;
    try {
      if (!raw.endsWith('\n')) throw new Error('missing newline');
      parsed = JSON.parse(raw.slice(0, -1));
      if (`${canonicalJson(parsed)}\n` !== raw) throw new Error('non-canonical head');
      assertExactKeys(parsed, ['schema', 'ledgerId', 'sequence', 'hash'], 'head');
      if (parsed.schema !== TRAJECTORY_HEAD_SCHEMA || parsed.ledgerId !== this.ledgerId) {
        throw new Error('head identity mismatch');
      }
      assertSafeCount(parsed.sequence, 'head.sequence');
      if (parsed.hash !== null) assertDigest(parsed.hash, 'head.hash');
    } catch (error) {
      throw ledgerFailure('HEAD_CORRUPT', 'advisory head is malformed', error);
    }
    const head = parsed as unknown as TrajectoryHead;
    const historicalHash = head.sequence === 0 ? null : events[head.sequence - 1]?.hash;
    if (head.sequence > current.sequence || historicalHash !== head.hash) {
      throw ledgerFailure('HEAD_CORRUPT', 'advisory head does not name a chain prefix');
    }
    if (!tipsEqual(head, current)) await this.writeHead(current);
  }

  private async writeHead(tip: LedgerTip): Promise<void> {
    const path = join(this.directory, HEAD_FILE);
    try {
      const metadata = await lstat(path);
      if (metadata.isSymbolicLink())
        throw ledgerFailure('SYMLINK_REJECTED', 'HEAD.json is a symlink');
      if (!metadata.isFile()) throw ledgerFailure('NON_REGULAR_FILE', 'HEAD.json is not regular');
    } catch (error) {
      if (!isNodeError(error, 'ENOENT')) throw error;
    }
    const head: TrajectoryHead = {
      schema: TRAJECTORY_HEAD_SCHEMA,
      ledgerId: this.ledgerId,
      sequence: tip.sequence,
      hash: tip.hash,
    };
    const temporary = join(
      this.directory,
      `.head.tmp-${process.pid}-${randomBytes(16).toString('hex')}`,
    );
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      handle = await open(temporary, 'wx', 0o600);
      await handle.writeFile(`${canonicalJson(head)}\n`, 'utf8');
      await handle.sync();
      await handle.close();
      handle = undefined;
      await rename(temporary, path);
      await chmod(path, 0o600);
      await this.syncDirectory();
    } catch (error) {
      if (error instanceof TrajectoryLedgerError) throw error;
      throw ledgerFailure('IO_ERROR', 'unable to update advisory head', error);
    } finally {
      await handle?.close().catch(() => undefined);
      await unlink(temporary).catch(() => undefined);
    }
  }

  private async syncDirectory(): Promise<void> {
    const handle = await open(this.directory, constants.O_RDONLY);
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  }
}
