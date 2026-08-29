import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';

import type { CoordinatorSnapshot } from './lifecycle-coordinator.js';
import { canonicalJson, type LedgerTip } from './trajectory-ledger.js';

export const RUNTIME_CHECKPOINT_SCHEMA = 'forgewright-runtime-checkpoint/v1' as const;
const CHECKPOINT_HEAD_SCHEMA = 'forgewright-runtime-checkpoint-head/v1' as const;
const CONTINUATION_RECEIPT_SCHEMA = 'forgewright-continuation-receipt/v1' as const;
const RECEIPT_HEAD_SCHEMA = 'forgewright-continuation-receipt-head/v1' as const;

export type SemanticBoundary =
  'before-model' | 'before-effect' | 'step-boundary' | 'pre-compaction' | 'handoff';

export interface ContinuationBudget {
  steps: number;
  tools: number;
  deadlineAtMs: number;
}

export interface RuntimeCheckpointInput {
  workspaceId: string;
  sessionId: string;
  trajectoryId: string;
  writerEpoch: number;
  boundary: SemanticBoundary;
  ledgerTip: LedgerTip;
  capabilityHash: string;
  treeFingerprint: string;
  snapshot: CoordinatorSnapshot;
  budget: ContinuationBudget;
}

export interface RuntimeCheckpoint extends RuntimeCheckpointInput {
  schema: typeof RUNTIME_CHECKPOINT_SCHEMA;
  sequence: number;
  checkpointId: string;
  continuationNonce: string;
  createdAtMs: number;
  previousHash: string | null;
  hash: string;
}

export interface ContinuationReceipt {
  schema: typeof CONTINUATION_RECEIPT_SCHEMA;
  checkpointId: string;
  sequence: number;
  requestId: string;
  nonceHash: string;
  steps: number;
  tools: number;
  cumulativeSteps: number;
  cumulativeTools: number;
  previousHash: string | null;
  createdAtMs: number;
  hash: string;
}

export interface ResumeCheckpointInput {
  workspaceId: string;
  sessionId: string;
  trajectoryId: string;
  checkpointHash: string;
  capabilityHash: string;
  treeFingerprint: string;
  writerEpoch: number;
  ledgerTip: LedgerTip;
}

export interface ResumedCheckpoint {
  checkpoint: RuntimeCheckpoint;
  remainingBudget: { steps: number; tools: number };
  nextWriterEpoch: number;
  continuationNonce: string;
  toolAuthority: false;
  requiresWorkspaceRegrounding: true;
}

export type RuntimeCheckpointErrorCode =
  | 'CHECKPOINT_INVALID'
  | 'CHECKPOINT_NOT_QUIESCENT'
  | 'CHECKPOINT_PATH_ESCAPE'
  | 'CHECKPOINT_SYMLINK'
  | 'CHECKPOINT_UNEXPECTED_ENTRY'
  | 'CHECKPOINT_TOO_LARGE'
  | 'CHECKPOINT_CHAIN_CORRUPT'
  | 'CHECKPOINT_HEAD_MISMATCH'
  | 'CHECKPOINT_MISSING'
  | 'CHECKPOINT_BINDING_MISMATCH'
  | 'CHECKPOINT_LEDGER_TIP_MISMATCH'
  | 'CHECKPOINT_EXPIRED'
  | 'CHECKPOINT_CONSUME_INVALID'
  | 'CHECKPOINT_REPLAY'
  | 'CHECKPOINT_BUDGET_OVERRUN'
  | 'CHECKPOINT_RECEIPT_CORRUPT'
  | 'CHECKPOINT_BUSY';

export class RuntimeCheckpointError extends Error {
  constructor(readonly code: RuntimeCheckpointErrorCode) {
    super(code);
    this.name = 'RuntimeCheckpointError';
  }
}

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const DIGEST = /^[0-9a-f]{64}$/;
const TREE = /^TREE:[0-9a-f]{64}$/;
const CHECKPOINT_FILE = /^checkpoint-(\d{8})\.json$/;
const RECEIPT_FILE = /^receipt-(\d{8})-(\d{8})\.json$/;
const MAX_RECORD_BYTES = 64 * 1024;
const MAX_RECORDS = 10_000;
const MAX_STEPS = 128;
const MAX_TOOLS = 256;
const MAX_DEADLINE_MS = 24 * 60 * 60 * 1_000;
const BOUNDARIES = new Set<SemanticBoundary>([
  'before-model',
  'before-effect',
  'step-boundary',
  'pre-compaction',
  'handoff',
]);

function sha256(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function safeCount(value: unknown, maximum: number): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= maximum;
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return keys.length === wanted.length && keys.every((key, index) => key === wanted[index]);
}

function within(root: string, candidate: string): boolean {
  const relation = relative(root, candidate);
  return relation === '' || (relation !== '..' && !relation.startsWith(`..${sep}`));
}

function hasSymlinkAncestor(path: string): boolean {
  let current = resolve(path);
  while (current.length > 0) {
    if (existsSync(current)) {
      const info = lstatSync(current);
      if (
        info.isSymbolicLink() &&
        (typeof process.getuid !== 'function' || info.uid === process.getuid())
      ) {
        return true;
      }
    }
    const parent = dirname(current);
    if (parent === current) return false;
    current = parent;
  }
  return false;
}

function ensureSafeId(value: unknown): value is string {
  return typeof value === 'string' && SAFE_ID.test(value);
}

function ensureDigest(value: unknown): value is string {
  return typeof value === 'string' && DIGEST.test(value);
}

function ensureTip(value: unknown): value is LedgerTip {
  if (!isRecord(value) || !exactKeys(value, ['sequence', 'hash'])) return false;
  return (
    safeCount(value.sequence, Number.MAX_SAFE_INTEGER) &&
    ((value.sequence === 0 && value.hash === null) ||
      (value.sequence > 0 && ensureDigest(value.hash)))
  );
}

function validSnapshot(value: unknown): value is CoordinatorSnapshot {
  return (
    isRecord(value) &&
    exactKeys(value, [
      'state',
      'activeOperationCount',
      'openScopeCount',
      'registeredDisposerCount',
    ]) &&
    value.state === 'ACTIVE' &&
    value.activeOperationCount === 0 &&
    value.openScopeCount === 1 &&
    value.registeredDisposerCount === 0
  );
}

function validBudget(value: unknown): value is ContinuationBudget {
  return (
    isRecord(value) &&
    exactKeys(value, ['steps', 'tools', 'deadlineAtMs']) &&
    safeCount(value.steps, MAX_STEPS) &&
    safeCount(value.tools, MAX_TOOLS) &&
    Number.isSafeInteger(value.deadlineAtMs) &&
    (value.deadlineAtMs as number) > 0
  );
}

function unsignedHash(value: Record<string, unknown>): string {
  const unsigned = { ...value };
  delete unsigned.hash;
  return sha256(unsigned);
}

interface WriterLock {
  path: string;
  token: string;
  descriptor: number;
}

export class RuntimeCheckpointStore {
  readonly root: string;

  constructor(root: string) {
    const configured = resolve(root);
    if (hasSymlinkAncestor(configured)) {
      throw new RuntimeCheckpointError('CHECKPOINT_SYMLINK');
    }
    if (!existsSync(configured)) mkdirSync(configured, { recursive: true, mode: 0o700 });
    const info = lstatSync(configured);
    if (info.isSymbolicLink() || !info.isDirectory()) {
      throw new RuntimeCheckpointError('CHECKPOINT_SYMLINK');
    }
    this.root = realpathSync(configured);
    chmodSync(this.root, 0o700);
    this.validateDirectoryEntries();
  }

  append(input: RuntimeCheckpointInput, nowMs = Date.now()): RuntimeCheckpoint {
    this.validateInput(input, nowMs);
    return this.withLock(() => {
      const records = this.records();
      if (records.length > 0) {
        const latest = records.at(-1)!;
        this.validateCheckpointHead(latest);
        if (
          latest.workspaceId !== input.workspaceId ||
          latest.sessionId !== input.sessionId ||
          latest.trajectoryId !== input.trajectoryId
        ) {
          throw new RuntimeCheckpointError('CHECKPOINT_BINDING_MISMATCH');
        }
      } else if (existsSync(join(this.root, 'checkpoint-head.json'))) {
        throw new RuntimeCheckpointError('CHECKPOINT_HEAD_MISMATCH');
      }
      if (records.length >= MAX_RECORDS) throw new RuntimeCheckpointError('CHECKPOINT_TOO_LARGE');
      const sequence = records.length + 1;
      const unsigned = {
        schema: RUNTIME_CHECKPOINT_SCHEMA,
        sequence,
        checkpointId: `checkpoint:${randomUUID()}`,
        continuationNonce: sha256(randomUUID()),
        createdAtMs: nowMs,
        previousHash: records.at(-1)?.hash ?? null,
        ...structuredClone(input),
      };
      const record: RuntimeCheckpoint = { ...unsigned, hash: sha256(unsigned) };
      const filename = `checkpoint-${String(sequence).padStart(8, '0')}.json`;
      this.atomicWrite(filename, record);
      this.atomicWrite('checkpoint-head.json', {
        schema: CHECKPOINT_HEAD_SCHEMA,
        sequence,
        checkpointId: record.checkpointId,
        checkpointHash: record.hash,
        file: filename,
      });
      return structuredClone(record);
    });
  }

  resume(expected: ResumeCheckpointInput, nowMs = Date.now()): ResumedCheckpoint {
    const checkpoint = this.latest();
    for (const field of [
      'workspaceId',
      'sessionId',
      'trajectoryId',
      'capabilityHash',
      'treeFingerprint',
      'writerEpoch',
    ] as const) {
      if (checkpoint[field] !== expected[field]) {
        throw new RuntimeCheckpointError('CHECKPOINT_BINDING_MISMATCH');
      }
    }
    if (checkpoint.hash !== expected.checkpointHash) {
      throw new RuntimeCheckpointError('CHECKPOINT_HEAD_MISMATCH');
    }
    if (
      checkpoint.ledgerTip.sequence !== expected.ledgerTip.sequence ||
      checkpoint.ledgerTip.hash !== expected.ledgerTip.hash
    ) {
      throw new RuntimeCheckpointError('CHECKPOINT_LEDGER_TIP_MISMATCH');
    }
    if (checkpoint.budget.deadlineAtMs <= nowMs) {
      throw new RuntimeCheckpointError('CHECKPOINT_EXPIRED');
    }
    const { steps, tools } = this.receiptUsage(checkpoint);
    if (steps > checkpoint.budget.steps || tools > checkpoint.budget.tools) {
      throw new RuntimeCheckpointError('CHECKPOINT_RECEIPT_CORRUPT');
    }
    if (!Number.isSafeInteger(checkpoint.writerEpoch + 1)) {
      throw new RuntimeCheckpointError('CHECKPOINT_INVALID');
    }
    return {
      checkpoint: structuredClone(checkpoint),
      remainingBudget: {
        steps: checkpoint.budget.steps - steps,
        tools: checkpoint.budget.tools - tools,
      },
      nextWriterEpoch: checkpoint.writerEpoch + 1,
      continuationNonce: checkpoint.continuationNonce,
      toolAuthority: false,
      requiresWorkspaceRegrounding: true,
    };
  }

  latest(): RuntimeCheckpoint {
    const checkpoint = this.records().at(-1);
    if (checkpoint === undefined) throw new RuntimeCheckpointError('CHECKPOINT_MISSING');
    this.validateCheckpointHead(checkpoint);
    return structuredClone(checkpoint);
  }

  async withPinnedLatest<Result>(
    expected: Pick<
      RuntimeCheckpointInput,
      'workspaceId' | 'sessionId' | 'capabilityHash' | 'treeFingerprint'
    >,
    operation: (checkpoint: RuntimeCheckpoint) => Promise<Result>,
    nowMs = Date.now(),
  ): Promise<Result> {
    const lock = this.acquireWriterLock();
    try {
      const checkpoint = this.latest();
      for (const field of [
        'workspaceId',
        'sessionId',
        'capabilityHash',
        'treeFingerprint',
      ] as const) {
        if (checkpoint[field] !== expected[field]) {
          throw new RuntimeCheckpointError('CHECKPOINT_BINDING_MISMATCH');
        }
      }
      if (checkpoint.budget.deadlineAtMs <= nowMs) {
        throw new RuntimeCheckpointError('CHECKPOINT_EXPIRED');
      }
      this.receiptUsage(checkpoint);
      return await operation(structuredClone(checkpoint));
    } finally {
      this.releaseWriterLock(lock);
    }
  }

  consume(
    checkpointId: string,
    continuationNonce: string,
    requestId: string,
    steps: number,
    tools: number,
    nowMs = Date.now(),
  ): ContinuationReceipt & { remainingSteps: number; remainingTools: number } {
    if (
      !ensureSafeId(checkpointId) ||
      !ensureDigest(continuationNonce) ||
      !ensureSafeId(requestId) ||
      !safeCount(steps, MAX_STEPS) ||
      !safeCount(tools, MAX_TOOLS) ||
      (steps === 0 && tools === 0)
    ) {
      throw new RuntimeCheckpointError('CHECKPOINT_CONSUME_INVALID');
    }
    return this.withLock(() => {
      const checkpoint = this.latest();
      if (
        checkpoint.checkpointId !== checkpointId ||
        checkpoint.continuationNonce !== continuationNonce
      ) {
        throw new RuntimeCheckpointError('CHECKPOINT_CONSUME_INVALID');
      }
      if (checkpoint.budget.deadlineAtMs <= nowMs) {
        throw new RuntimeCheckpointError('CHECKPOINT_EXPIRED');
      }
      const receipts = this.receipts(checkpoint);
      if (receipts.some((receipt) => receipt.requestId === requestId)) {
        throw new RuntimeCheckpointError('CHECKPOINT_REPLAY');
      }
      const usedSteps = receipts.reduce((total, receipt) => total + receipt.steps, 0);
      const usedTools = receipts.reduce((total, receipt) => total + receipt.tools, 0);
      if (
        usedSteps + steps > checkpoint.budget.steps ||
        usedTools + tools > checkpoint.budget.tools
      ) {
        throw new RuntimeCheckpointError('CHECKPOINT_BUDGET_OVERRUN');
      }
      const sequence = receipts.length + 1;
      const unsigned = {
        schema: CONTINUATION_RECEIPT_SCHEMA,
        checkpointId,
        sequence,
        requestId,
        nonceHash: sha256(continuationNonce),
        steps,
        tools,
        cumulativeSteps: usedSteps + steps,
        cumulativeTools: usedTools + tools,
        previousHash: receipts.at(-1)?.hash ?? null,
        createdAtMs: nowMs,
      };
      const receipt: ContinuationReceipt = { ...unsigned, hash: sha256(unsigned) };
      const prefix = String(checkpoint.sequence).padStart(8, '0');
      const filename = `receipt-${prefix}-${String(sequence).padStart(8, '0')}.json`;
      this.atomicWrite(filename, receipt);
      this.atomicWrite(`receipt-head-${prefix}.json`, {
        schema: RECEIPT_HEAD_SCHEMA,
        checkpointId,
        sequence,
        receiptHash: receipt.hash,
        file: filename,
      });
      return {
        ...structuredClone(receipt),
        remainingSteps: checkpoint.budget.steps - receipt.cumulativeSteps,
        remainingTools: checkpoint.budget.tools - receipt.cumulativeTools,
      };
    });
  }

  private validateInput(input: RuntimeCheckpointInput, nowMs: number): void {
    if (
      !ensureSafeId(input.workspaceId) ||
      !ensureSafeId(input.sessionId) ||
      !ensureSafeId(input.trajectoryId) ||
      !safeCount(input.writerEpoch, Number.MAX_SAFE_INTEGER - 1) ||
      input.writerEpoch < 1 ||
      !BOUNDARIES.has(input.boundary) ||
      !ensureTip(input.ledgerTip) ||
      !ensureDigest(input.capabilityHash) ||
      typeof input.treeFingerprint !== 'string' ||
      !TREE.test(input.treeFingerprint) ||
      !validSnapshot(input.snapshot)
    ) {
      throw new RuntimeCheckpointError(
        input.snapshot?.activeOperationCount !== 0 ||
          input.snapshot?.openScopeCount !== 1 ||
          input.snapshot?.registeredDisposerCount !== 0
          ? 'CHECKPOINT_NOT_QUIESCENT'
          : 'CHECKPOINT_INVALID',
      );
    }
    if (
      !validBudget(input.budget) ||
      input.budget.deadlineAtMs <= nowMs ||
      input.budget.deadlineAtMs - nowMs > MAX_DEADLINE_MS
    ) {
      throw new RuntimeCheckpointError('CHECKPOINT_INVALID');
    }
  }

  private records(): RuntimeCheckpoint[] {
    this.validateDirectoryEntries();
    const filenames = readdirSync(this.root)
      .filter((name) => CHECKPOINT_FILE.test(name))
      .sort();
    let previousHash: string | null = null;
    return filenames.map((filename, index) => {
      const record = this.readJson(filename);
      if (!this.validCheckpoint(record, index + 1, previousHash)) {
        throw new RuntimeCheckpointError('CHECKPOINT_CHAIN_CORRUPT');
      }
      previousHash = record.hash;
      return record;
    });
  }

  private validCheckpoint(
    value: unknown,
    sequence: number,
    previousHash: string | null,
  ): value is RuntimeCheckpoint {
    if (!isRecord(value)) return false;
    const required = [
      'schema',
      'sequence',
      'checkpointId',
      'continuationNonce',
      'createdAtMs',
      'previousHash',
      'workspaceId',
      'sessionId',
      'trajectoryId',
      'writerEpoch',
      'boundary',
      'ledgerTip',
      'capabilityHash',
      'treeFingerprint',
      'snapshot',
      'budget',
      'hash',
    ];
    return (
      exactKeys(value, required) &&
      value.schema === RUNTIME_CHECKPOINT_SCHEMA &&
      value.sequence === sequence &&
      ensureSafeId(value.checkpointId) &&
      ensureDigest(value.continuationNonce) &&
      safeCount(value.createdAtMs, Number.MAX_SAFE_INTEGER) &&
      ensureSafeId(value.workspaceId) &&
      ensureSafeId(value.sessionId) &&
      ensureSafeId(value.trajectoryId) &&
      safeCount(value.writerEpoch, Number.MAX_SAFE_INTEGER - 1) &&
      (value.writerEpoch as number) >= 1 &&
      BOUNDARIES.has(value.boundary as SemanticBoundary) &&
      ensureTip(value.ledgerTip) &&
      ensureDigest(value.capabilityHash) &&
      typeof value.treeFingerprint === 'string' &&
      TREE.test(value.treeFingerprint) &&
      validSnapshot(value.snapshot) &&
      validBudget(value.budget) &&
      value.previousHash === previousHash &&
      ensureDigest(value.hash) &&
      value.hash === unsignedHash(value)
    );
  }

  private validateCheckpointHead(checkpoint: RuntimeCheckpoint): void {
    const head = this.readJson('checkpoint-head.json');
    if (
      !isRecord(head) ||
      !exactKeys(head, ['schema', 'sequence', 'checkpointId', 'checkpointHash', 'file']) ||
      head.schema !== CHECKPOINT_HEAD_SCHEMA ||
      head.sequence !== checkpoint.sequence ||
      head.checkpointId !== checkpoint.checkpointId ||
      head.checkpointHash !== checkpoint.hash ||
      head.file !== `checkpoint-${String(checkpoint.sequence).padStart(8, '0')}.json`
    ) {
      throw new RuntimeCheckpointError('CHECKPOINT_HEAD_MISMATCH');
    }
  }

  private receipts(checkpoint: RuntimeCheckpoint): ContinuationReceipt[] {
    const prefix = String(checkpoint.sequence).padStart(8, '0');
    const filenames = readdirSync(this.root)
      .filter((name) => name.startsWith(`receipt-${prefix}-`))
      .sort();
    let previousHash: string | null = null;
    let cumulativeSteps = 0;
    let cumulativeTools = 0;
    const requestIds = new Set<string>();
    const receipts = filenames.map((filename, index) => {
      const match = RECEIPT_FILE.exec(filename);
      const value = this.readJson(filename);
      if (
        match === null ||
        Number(match[1]) !== checkpoint.sequence ||
        Number(match[2]) !== index + 1 ||
        !this.validReceipt(value, checkpoint, index + 1, previousHash) ||
        requestIds.has(value.requestId)
      ) {
        throw new RuntimeCheckpointError('CHECKPOINT_RECEIPT_CORRUPT');
      }
      cumulativeSteps += value.steps;
      cumulativeTools += value.tools;
      if (value.cumulativeSteps !== cumulativeSteps || value.cumulativeTools !== cumulativeTools) {
        throw new RuntimeCheckpointError('CHECKPOINT_RECEIPT_CORRUPT');
      }
      requestIds.add(value.requestId);
      previousHash = value.hash;
      return value;
    });
    const headName = `receipt-head-${prefix}.json`;
    if (receipts.length === 0) {
      if (existsSync(join(this.root, headName))) {
        throw new RuntimeCheckpointError('CHECKPOINT_RECEIPT_CORRUPT');
      }
      return receipts;
    }
    const head = this.readJson(headName);
    const latest = receipts.at(-1)!;
    if (
      !isRecord(head) ||
      !exactKeys(head, ['schema', 'checkpointId', 'sequence', 'receiptHash', 'file']) ||
      head.schema !== RECEIPT_HEAD_SCHEMA ||
      head.checkpointId !== checkpoint.checkpointId ||
      head.sequence !== receipts.length ||
      head.receiptHash !== latest.hash ||
      head.file !== filenames.at(-1)
    ) {
      throw new RuntimeCheckpointError('CHECKPOINT_RECEIPT_CORRUPT');
    }
    return receipts;
  }

  private validReceipt(
    value: unknown,
    checkpoint: RuntimeCheckpoint,
    sequence: number,
    previousHash: string | null,
  ): value is ContinuationReceipt {
    if (!isRecord(value)) return false;
    return (
      exactKeys(value, [
        'schema',
        'checkpointId',
        'sequence',
        'requestId',
        'nonceHash',
        'steps',
        'tools',
        'cumulativeSteps',
        'cumulativeTools',
        'previousHash',
        'createdAtMs',
        'hash',
      ]) &&
      value.schema === CONTINUATION_RECEIPT_SCHEMA &&
      value.checkpointId === checkpoint.checkpointId &&
      value.sequence === sequence &&
      ensureSafeId(value.requestId) &&
      value.nonceHash === sha256(checkpoint.continuationNonce) &&
      safeCount(value.steps, MAX_STEPS) &&
      safeCount(value.tools, MAX_TOOLS) &&
      safeCount(value.cumulativeSteps, MAX_STEPS) &&
      safeCount(value.cumulativeTools, MAX_TOOLS) &&
      value.previousHash === previousHash &&
      ensureDigest(value.hash) &&
      value.hash === unsignedHash(value)
    );
  }

  private receiptUsage(checkpoint: RuntimeCheckpoint): { steps: number; tools: number } {
    const receipts = this.receipts(checkpoint);
    return {
      steps: receipts.reduce((total, receipt) => total + receipt.steps, 0),
      tools: receipts.reduce((total, receipt) => total + receipt.tools, 0),
    };
  }

  private validateDirectoryEntries(): void {
    for (const name of readdirSync(this.root)) {
      if (
        CHECKPOINT_FILE.test(name) ||
        RECEIPT_FILE.test(name) ||
        name === 'checkpoint-head.json' ||
        /^receipt-head-\d{8}\.json$/.test(name) ||
        name === '.writer.lock' ||
        /^\..+\.[A-Za-z0-9-]+\.tmp$/.test(name)
      ) {
        continue;
      }
      throw new RuntimeCheckpointError('CHECKPOINT_UNEXPECTED_ENTRY');
    }
  }

  private readJson(name: string): unknown {
    const path = this.pathFor(name);
    const info = lstatSync(path);
    if (info.isSymbolicLink() || !info.isFile()) {
      throw new RuntimeCheckpointError('CHECKPOINT_SYMLINK');
    }
    if (info.size > MAX_RECORD_BYTES) throw new RuntimeCheckpointError('CHECKPOINT_TOO_LARGE');
    const descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      return JSON.parse(readFileSync(descriptor, 'utf8'));
    } catch {
      throw new RuntimeCheckpointError('CHECKPOINT_CHAIN_CORRUPT');
    } finally {
      closeSync(descriptor);
    }
  }

  private atomicWrite(name: string, value: unknown): void {
    const path = this.pathFor(name);
    if (existsSync(path)) {
      const info = lstatSync(path);
      if (info.isSymbolicLink() || !info.isFile()) {
        throw new RuntimeCheckpointError('CHECKPOINT_SYMLINK');
      }
    }
    const payload = `${canonicalJson(value)}\n`;
    if (Buffer.byteLength(payload, 'utf8') > MAX_RECORD_BYTES) {
      throw new RuntimeCheckpointError('CHECKPOINT_TOO_LARGE');
    }
    const temporary = join(this.root, `.${name}.${randomUUID()}.tmp`);
    const descriptor = openSync(temporary, 'wx', 0o600);
    try {
      writeFileSync(descriptor, payload, 'utf8');
      fsyncSync(descriptor);
    } finally {
      closeSync(descriptor);
    }
    try {
      renameSync(temporary, path);
      chmodSync(path, 0o600);
      const directory = openSync(this.root, constants.O_RDONLY);
      try {
        fsyncSync(directory);
      } finally {
        closeSync(directory);
      }
    } finally {
      if (existsSync(temporary) && !lstatSync(temporary).isSymbolicLink()) unlinkSync(temporary);
    }
  }

  private pathFor(name: string): string {
    const path = resolve(this.root, name);
    if (!within(this.root, path) || dirname(path) !== this.root) {
      throw new RuntimeCheckpointError('CHECKPOINT_PATH_ESCAPE');
    }
    return path;
  }

  private withLock<Result>(operation: () => Result): Result {
    const lock = this.acquireWriterLock();
    try {
      return operation();
    } finally {
      this.releaseWriterLock(lock);
    }
  }

  private acquireWriterLock(): WriterLock {
    const path = this.pathFor('.writer.lock');
    const token = randomUUID();
    return { path, token, descriptor: this.acquireLock(path, token, true) };
  }

  private releaseWriterLock(lock: WriterLock): void {
    closeSync(lock.descriptor);
    const owner = this.readLock(lock.path);
    if (owner?.token === lock.token) unlinkSync(lock.path);
  }

  private acquireLock(path: string, token: string, allowReclaim: boolean): number {
    try {
      const descriptor = openSync(path, 'wx', 0o600);
      writeFileSync(
        descriptor,
        `${canonicalJson({ pid: process.pid, token, createdAtMs: Date.now() })}\n`,
        'utf8',
      );
      fsyncSync(descriptor);
      return descriptor;
    } catch (error) {
      if (
        allowReclaim &&
        isRecord(error) &&
        error.code === 'EEXIST' &&
        this.reclaimDeadLock(path)
      ) {
        return this.acquireLock(path, token, false);
      }
      throw new RuntimeCheckpointError('CHECKPOINT_BUSY');
    }
  }

  private reclaimDeadLock(path: string): boolean {
    const owner = this.readLock(path);
    if (owner === null || !safeCount(owner.pid, Number.MAX_SAFE_INTEGER) || owner.pid < 1) {
      return false;
    }
    try {
      process.kill(owner.pid, 0);
      return false;
    } catch (error) {
      if (!isRecord(error) || error.code !== 'ESRCH') return false;
    }
    const current = this.readLock(path);
    if (current?.token !== owner.token) return false;
    unlinkSync(path);
    return true;
  }

  private readLock(path: string): { pid: number; token: string; createdAtMs: number } | null {
    try {
      const info = lstatSync(path);
      if (info.isSymbolicLink() || !info.isFile() || info.size > 1024) return null;
      const descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const value: unknown = JSON.parse(readFileSync(descriptor, 'utf8'));
        if (
          !isRecord(value) ||
          !exactKeys(value, ['pid', 'token', 'createdAtMs']) ||
          !safeCount(value.pid, Number.MAX_SAFE_INTEGER) ||
          !ensureSafeId(value.token) ||
          !safeCount(value.createdAtMs, Number.MAX_SAFE_INTEGER)
        ) {
          return null;
        }
        return value as unknown as { pid: number; token: string; createdAtMs: number };
      } finally {
        closeSync(descriptor);
      }
    } catch {
      return null;
    }
  }
}
