import { createHash } from 'node:crypto';

export const HARNESS_ADAPTER_SCHEMA = 'forgewright-harness-adapter/v1' as const;

export type HarnessLoopMode = 'forgewright-owned-loop' | 'native-host-loop';
export type LifecycleOperation = 'start' | 'resume' | 'fork' | 'steer' | 'interrupt' | 'checkpoint';
export type PrecompactCapability = 'native' | 'material-event-fallback' | 'unsupported';

export interface HarnessCapabilities {
  operations: Record<LifecycleOperation, boolean>;
  precompact: PrecompactCapability;
}

export interface ResumeBinding {
  workspaceId: string;
  sessionId: string;
  turnId: string;
  checkpointHash: string;
  ledgerOffset: number;
  ledgerHeadHash: string;
  capabilityHash: string;
  issuedAt: string;
  expiresAt: string;
}

export interface StartResult {
  sessionId: string;
}

export interface CheckpointResult {
  checkpointHash: string;
  ledgerOffset: number;
}

export interface HarnessAdapter {
  readonly schema: typeof HARNESS_ADAPTER_SCHEMA;
  readonly mode: HarnessLoopMode;
  readonly capabilities: HarnessCapabilities;
  start(input?: unknown): Promise<StartResult>;
  resume?(binding: ResumeBinding): Promise<StartResult>;
  fork?(input?: unknown): Promise<StartResult>;
  steer?(input: unknown): Promise<void>;
  interrupt?(): Promise<void>;
  checkpoint?(): Promise<CheckpointResult>;
}

export interface NegotiatedHarness {
  schema: typeof HARNESS_ADAPTER_SCHEMA;
  mode: HarnessLoopMode;
  operations: Record<LifecycleOperation, boolean>;
  precompact: PrecompactCapability;
  capabilityHash: string;
}

const OPERATIONS: LifecycleOperation[] = [
  'start',
  'resume',
  'fork',
  'steer',
  'interrupt',
  'checkpoint',
];
const PRECOMPACT_CAPABILITIES = new Set<PrecompactCapability>([
  'native',
  'material-event-fallback',
  'unsupported',
]);

export class HarnessCompatibilityError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'HarnessCompatibilityError';
  }
}

function stableHash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function validIsoDate(value: string): boolean {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

export function negotiateHarnessAdapter(
  adapter: HarnessAdapter,
  required: LifecycleOperation[],
): NegotiatedHarness {
  if (adapter.schema !== HARNESS_ADAPTER_SCHEMA) {
    throw new HarnessCompatibilityError('unsupported_schema');
  }
  if (adapter.mode !== 'forgewright-owned-loop' && adapter.mode !== 'native-host-loop') {
    throw new HarnessCompatibilityError('invalid_loop_mode');
  }
  if (!PRECOMPACT_CAPABILITIES.has(adapter.capabilities.precompact)) {
    throw new HarnessCompatibilityError('invalid_precompact_capability');
  }

  const operationKeys = Object.keys(adapter.capabilities.operations);
  if (
    operationKeys.length !== OPERATIONS.length ||
    operationKeys.some((operation) => !OPERATIONS.includes(operation as LifecycleOperation))
  ) {
    throw new HarnessCompatibilityError('invalid_operation_capabilities');
  }
  for (const operation of OPERATIONS) {
    if (typeof adapter.capabilities.operations[operation] !== 'boolean') {
      throw new HarnessCompatibilityError(`invalid_operation_capability:${operation}`);
    }
  }
  for (const operation of required) {
    if (!OPERATIONS.includes(operation)) {
      throw new HarnessCompatibilityError(`unknown_operation:${String(operation)}`);
    }
    if (!adapter.capabilities.operations[operation]) {
      throw new HarnessCompatibilityError(`unsupported_operation:${operation}`);
    }
    if (operation !== 'start' && typeof adapter[operation] !== 'function') {
      throw new HarnessCompatibilityError(`missing_operation_implementation:${operation}`);
    }
  }

  const contract = {
    schema: HARNESS_ADAPTER_SCHEMA,
    mode: adapter.mode,
    operations: { ...adapter.capabilities.operations },
    precompact: adapter.capabilities.precompact,
  };
  return { ...contract, capabilityHash: stableHash(contract) };
}

export function validateResumeToken(
  token: ResumeBinding,
  expected: ResumeBinding,
  now = new Date(),
): ResumeBinding {
  const fields: Array<keyof ResumeBinding> = [
    'workspaceId',
    'sessionId',
    'turnId',
    'checkpointHash',
    'ledgerOffset',
    'ledgerHeadHash',
    'capabilityHash',
    'issuedAt',
    'expiresAt',
  ];
  for (const field of fields) {
    if (token[field] !== expected[field]) {
      throw new HarnessCompatibilityError(`resume_binding_mismatch:${field}`);
    }
  }
  if (!validIsoDate(token.issuedAt) || !validIsoDate(token.expiresAt)) {
    throw new HarnessCompatibilityError('resume_token_invalid_time');
  }
  if (Date.parse(token.expiresAt) < now.getTime()) {
    throw new HarnessCompatibilityError('resume_token_expired');
  }
  if (Date.parse(token.issuedAt) > now.getTime()) {
    throw new HarnessCompatibilityError('resume_token_not_yet_valid');
  }
  return { ...token };
}
