import { createHash } from 'node:crypto';
import { z } from 'zod';
import {
  EnvironmentAciDescriptor,
  EnvironmentKind,
  parseEnvironmentAciDescriptor,
} from './environment-aci.js';
import { ProductIntent, SafeIdSchema, parseProductIntent } from './product-intent.js';

export const PRODUCT_OUTCOME_CONTRACT_SCHEMA_VERSION = 'product-outcome-contract/v1' as const;
export const PRODUCT_OUTCOME_CONTRACT_MAX_BYTES = 256 * 1024;

const MAX_ITEMS = 256;
const MAX_TEXT = 4096;
const MAX_JSON_DEPTH = 32;
const MAX_JSON_NODES = 16_384;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const MEDIA_TYPE_PATTERN = /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/i;

export const PRODUCT_OUTCOME_ASSERTION_CATEGORIES = [
  'requirement',
  'environment',
  'visual',
  'accessibility',
  'performance',
  'security',
  'reliability',
  'release',
  'subjective-game',
] as const;

export type ProductOutcomeAssertionCategory = (typeof PRODUCT_OUTCOME_ASSERTION_CATEGORIES)[number];
export type ProductOutcomeMachineAssertionCategory = Exclude<
  ProductOutcomeAssertionCategory,
  'subjective-game'
>;

export const PRODUCT_OUTCOME_ACTION_KINDS = [
  'navigate',
  'click',
  'fill',
  'type',
  'select',
  'press',
  'scroll',
  'wait',
  'tap',
  'input-text',
  'launch-app',
  'swipe',
  'press-key',
  'load-scene',
  'invoke',
  'set-input',
  'advance-frames',
] as const;

export type ProductOutcomeActionKind = (typeof PRODUCT_OUTCOME_ACTION_KINDS)[number];

const ACTION_KIND_ENVIRONMENTS: Readonly<
  Record<ProductOutcomeActionKind, readonly EnvironmentKind[]>
> = {
  navigate: ['web'],
  click: ['web'],
  fill: ['web'],
  type: ['web'],
  select: ['web'],
  press: ['web'],
  scroll: ['web'],
  wait: ['web', 'android', 'unity'],
  tap: ['android'],
  'input-text': ['android'],
  'launch-app': ['android'],
  swipe: ['android'],
  'press-key': ['android'],
  'load-scene': ['unity'],
  invoke: ['unity'],
  'set-input': ['unity'],
  'advance-frames': ['unity'],
};

const PLATFORM_ENVIRONMENTS: Readonly<Record<EnvironmentKind, readonly string[]>> = {
  web: ['web', 'cross-platform'],
  android: ['mobile', 'cross-platform'],
  unity: ['game', 'cross-platform'],
};

export type ProductOutcomeContractErrorCode =
  | 'CONTRACT_SIZE_LIMIT'
  | 'CONTRACT_MALFORMED'
  | 'CONTRACT_DIGEST_INVALID'
  | 'CONTRACT_RELATIONSHIP_INVALID'
  | 'INTENT_INVALID'
  | 'INTENT_BINDING_INVALID'
  | 'OUTCOME_REFERENCE_INVALID'
  | 'SCENARIO_REFERENCE_INVALID'
  | 'SCENARIO_PLATFORM_INVALID'
  | 'ENVIRONMENT_BINDING_INVALID'
  | 'ACTION_KIND_INVALID'
  | 'JOURNEY_STATE_INVALID'
  | 'SYNTHETIC_USER_AUTHORITY_INVALID';

export class ProductOutcomeContractValidationError extends Error {
  constructor(readonly code: ProductOutcomeContractErrorCode) {
    super(code);
    this.name = 'ProductOutcomeContractValidationError';
  }
}

function fail(code: ProductOutcomeContractErrorCode): never {
  throw new ProductOutcomeContractValidationError(code);
}

function boundedBytes(value: unknown): number {
  try {
    const serialized = JSON.stringify(value);
    if (serialized === undefined) fail('CONTRACT_MALFORMED');
    return Buffer.byteLength(serialized, 'utf8');
  } catch (error) {
    if (error instanceof ProductOutcomeContractValidationError) throw error;
    fail('CONTRACT_MALFORMED');
  }
}

function assertBounded(value: unknown): void {
  if (boundedBytes(value) > PRODUCT_OUTCOME_CONTRACT_MAX_BYTES) fail('CONTRACT_SIZE_LIMIT');
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

export function hashProductOutcomePayload(value: unknown): string {
  assertBounded(value);
  return createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex');
}

function countJsonNodes(value: unknown, depth = 0): number {
  if (depth > MAX_JSON_DEPTH) fail('CONTRACT_MALFORMED');
  if (value === null || typeof value !== 'object') return 1;
  const children = Array.isArray(value) ? value : Object.values(value as Record<string, unknown>);
  let count = 1;
  for (const child of children) {
    count += countJsonNodes(child, depth + 1);
    if (count > MAX_JSON_NODES) fail('CONTRACT_MALFORMED');
  }
  return count;
}

const JsonValueSchema = z.unknown().superRefine((value, context) => {
  const visit = (candidate: unknown, depth: number): void => {
    if (depth > MAX_JSON_DEPTH) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'JSON depth limit exceeded.' });
      return;
    }
    if (
      candidate === null ||
      typeof candidate === 'string' ||
      typeof candidate === 'boolean' ||
      (typeof candidate === 'number' && Number.isFinite(candidate))
    ) {
      return;
    }
    if (Array.isArray(candidate)) {
      for (const item of candidate) visit(item, depth + 1);
      return;
    }
    if (typeof candidate === 'object') {
      const prototype = Object.getPrototypeOf(candidate);
      if (prototype !== Object.prototype && prototype !== null) {
        context.addIssue({ code: z.ZodIssueCode.custom, message: 'Expected plain JSON.' });
        return;
      }
      for (const [key, item] of Object.entries(candidate as Record<string, unknown>)) {
        if (
          key.length === 0 ||
          key.length > 256 ||
          ['__proto__', 'prototype', 'constructor'].includes(key)
        ) {
          context.addIssue({ code: z.ZodIssueCode.custom, message: 'Unsafe JSON key.' });
        }
        visit(item, depth + 1);
      }
      return;
    }
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Expected finite JSON.' });
  };
  visit(value, 0);
  countJsonNodes(value);
});

const TextSchema = z.string().trim().min(1).max(MAX_TEXT);
const ShortTextSchema = z.string().trim().min(1).max(512);
const Sha256Schema = z.string().regex(SHA256_PATTERN);
const MediaTypeSchema = z.string().regex(MEDIA_TYPE_PATTERN);

function strictAction<K extends ProductOutcomeActionKind, S extends z.ZodTypeAny>(
  kind: K,
  payload: S,
) {
  return z.object({ actionId: SafeIdSchema, kind: z.literal(kind), payload }).strict();
}

const NavigatePayloadSchema = z
  .object({ path: ShortTextSchema.optional(), url: ShortTextSchema.optional() })
  .strict()
  .superRefine((value, context) => {
    if ((value.path === undefined) === (value.url === undefined)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Navigate requires exactly one path or URL.',
      });
    }
  });

const TapPayloadSchema = z
  .object({
    target: ShortTextSchema.optional(),
    x: z.number().finite().optional(),
    y: z.number().finite().optional(),
  })
  .strict()
  .superRefine((value, context) => {
    const coordinates = value.x !== undefined && value.y !== undefined;
    if (!value.target && !coordinates) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Tap requires a target or coordinates.',
      });
    }
  });

// Preserve legacy host payloads while accepting the canonical Web ACI wire shape.
// Targets remain semantic and strict; selectors or extra fields are not accepted.
const WebSemanticTargetSchema = z.object({ role: ShortTextSchema, name: ShortTextSchema }).strict();

export const ProductOutcomeActionSchema = z.union([
  strictAction('navigate', NavigatePayloadSchema),
  strictAction(
    'click',
    z.object({ target: z.union([ShortTextSchema, WebSemanticTargetSchema]) }).strict(),
  ),
  strictAction(
    'fill',
    z.object({ target: WebSemanticTargetSchema, value: z.string().max(MAX_TEXT) }).strict(),
  ),
  strictAction('type', z.object({ target: ShortTextSchema, text: TextSchema }).strict()),
  strictAction('select', z.object({ target: ShortTextSchema, value: TextSchema }).strict()),
  strictAction('press', z.object({ key: ShortTextSchema }).strict()),
  strictAction(
    'scroll',
    z.union([
      z.object({ xDelta: z.number().finite(), yDelta: z.number().finite() }).strict(),
      z.object({ deltaY: z.number().finite() }).strict(),
    ]),
  ),
  strictAction('wait', z.object({ durationMs: z.number().int().min(0).max(120_000) }).strict()),
  strictAction('tap', TapPayloadSchema),
  strictAction('input-text', z.object({ target: ShortTextSchema, text: TextSchema }).strict()),
  strictAction('launch-app', z.object({ packageId: ShortTextSchema }).strict()),
  strictAction(
    'swipe',
    z
      .object({
        startX: z.number().finite(),
        startY: z.number().finite(),
        endX: z.number().finite(),
        endY: z.number().finite(),
        durationMs: z.number().int().min(1).max(120_000),
      })
      .strict(),
  ),
  strictAction('press-key', z.object({ key: ShortTextSchema }).strict()),
  strictAction('load-scene', z.object({ scene: ShortTextSchema }).strict()),
  strictAction(
    'invoke',
    z.object({ target: ShortTextSchema, command: ShortTextSchema, args: JsonValueSchema }).strict(),
  ),
  strictAction(
    'set-input',
    z.object({ control: ShortTextSchema, value: JsonValueSchema }).strict(),
  ),
  strictAction(
    'advance-frames',
    z.object({ frames: z.number().int().min(1).max(1_000_000) }).strict(),
  ),
]);

export type ProductOutcomeAction = z.infer<typeof ProductOutcomeActionSchema>;

export const ProductOutcomeMachineAssertionCategorySchema = z.enum([
  'requirement',
  'environment',
  'visual',
  'accessibility',
  'performance',
  'security',
  'reliability',
  'release',
]);

const PathSegmentSchema = z.union([
  z
    .string()
    .min(1)
    .max(128)
    .refine((value) => !['__proto__', 'prototype', 'constructor'].includes(value)),
  z.number().int().min(0).max(1_000_000),
]);

export const ProductOutcomeAssertionSubjectSchema = z.union([
  z
    .object({
      kind: z.literal('observation'),
      actionId: SafeIdSchema,
      path: z.array(PathSegmentSchema).min(1).max(32),
    })
    .strict(),
  z
    .object({
      kind: z.literal('artifact'),
      actionId: SafeIdSchema,
      mediaType: MediaTypeSchema.nullable(),
      field: z.enum(['count', 'total-bytes']),
    })
    .strict(),
  z
    .object({
      kind: z.literal('receipt'),
      field: z.enum([
        'status',
        'action-count',
        'evidence-count',
        'artifact-count',
        'negative-path-count',
        'limitation-count',
        'duration-ms',
      ]),
    })
    .strict(),
]);

export type ProductOutcomeAssertionSubject = z.infer<typeof ProductOutcomeAssertionSubjectSchema>;

export const ProductOutcomeExpectedValueSchema = z.union([
  z
    .object({
      kind: z.literal('boolean'),
      operator: z.enum(['equals', 'not-equals']),
      value: z.boolean(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('string'),
      operator: z.enum(['equals', 'not-equals', 'contains', 'starts-with', 'ends-with']),
      value: TextSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal('number'),
      operator: z.enum([
        'equals',
        'not-equals',
        'greater-than',
        'at-least',
        'less-than',
        'at-most',
      ]),
      value: z.number().finite(),
      unit: ShortTextSchema.nullable().default(null),
    })
    .strict(),
  z
    .object({
      kind: z.literal('existence'),
      operator: z.enum(['exists', 'not-exists']),
    })
    .strict(),
]);

export type ProductOutcomeExpectedValue = z.infer<typeof ProductOutcomeExpectedValueSchema>;

export const ProductOutcomeMachineAssertionSchema = z
  .object({
    id: SafeIdSchema,
    category: ProductOutcomeMachineAssertionCategorySchema,
    subject: ProductOutcomeAssertionSubjectSchema,
    expected: ProductOutcomeExpectedValueSchema,
  })
  .strict();

export const ProductOutcomeHumanAssertionSchema = z
  .object({
    id: SafeIdSchema,
    category: z.literal('subjective-game'),
    boundary: z.enum(['fun', 'taste', 'commercial-appeal']),
    prompt: TextSchema,
    expected: z.object({ kind: z.literal('human-review') }).strict(),
  })
  .strict();

export const ProductOutcomeAssertionSchema = z.union([
  ProductOutcomeMachineAssertionSchema,
  ProductOutcomeHumanAssertionSchema,
]);

export type ProductOutcomeMachineAssertion = z.infer<typeof ProductOutcomeMachineAssertionSchema>;
export type ProductOutcomeHumanAssertion = z.infer<typeof ProductOutcomeHumanAssertionSchema>;
export type ProductOutcomeAssertion = z.infer<typeof ProductOutcomeAssertionSchema>;

export const ProductOutcomeEvidenceRequirementSchema = z
  .object({
    id: SafeIdSchema,
    actionId: SafeIdSchema,
    mediaTypes: z.array(MediaTypeSchema).min(1).max(32),
    minimumArtifacts: z.number().int().min(1).max(MAX_ITEMS),
  })
  .strict();

export type ProductOutcomeEvidenceRequirement = z.infer<
  typeof ProductOutcomeEvidenceRequirementSchema
>;

const IntentBindingSchema = z
  .object({
    intentId: SafeIdSchema,
    version: z.number().int().min(1).max(1_000_000_000),
    hash: Sha256Schema,
  })
  .strict();

const EnvironmentBindingSchema = z
  .object({
    adapterId: SafeIdSchema,
    environmentId: SafeIdSchema,
    sessionId: SafeIdSchema,
    kind: z.enum(['web', 'android', 'unity']),
    environmentFingerprint: Sha256Schema,
    capabilityFingerprint: Sha256Schema,
  })
  .strict();

const JourneySchema = z
  .object({
    scenarioId: SafeIdSchema,
    desiredOutcomeIds: z.array(SafeIdSchema).min(1).max(MAX_ITEMS),
    applicable: z.boolean(),
    runnable: z.boolean(),
    stateReason: TextSchema.nullable(),
    actions: z.array(ProductOutcomeActionSchema).max(MAX_ITEMS),
    assertions: z.array(ProductOutcomeAssertionSchema).max(MAX_ITEMS),
    requiredEvidence: z.array(ProductOutcomeEvidenceRequirementSchema).max(MAX_ITEMS),
    negativePaths: z.array(SafeIdSchema).max(MAX_ITEMS),
    limitations: z.array(TextSchema).max(MAX_ITEMS),
  })
  .strict();

const ContractInputSchema = z
  .object({
    contractId: SafeIdSchema,
    intent: IntentBindingSchema,
    desiredOutcomeIds: z.array(SafeIdSchema).min(1).max(MAX_ITEMS),
    scenarioIds: z.array(SafeIdSchema).min(1).max(MAX_ITEMS),
    environment: EnvironmentBindingSchema,
    evidenceAuthority: z.enum(['production', 'test-only']),
    syntheticUser: z.boolean(),
    journeys: z.array(JourneySchema).min(1).max(MAX_ITEMS),
  })
  .strict();

export const ProductOutcomeContractSchema = ContractInputSchema.extend({
  schemaVersion: z.literal(PRODUCT_OUTCOME_CONTRACT_SCHEMA_VERSION),
  contractSha256: Sha256Schema,
}).strict();

export type ProductOutcomeContractInput = z.input<typeof ContractInputSchema>;
export type ProductOutcomeContract = z.infer<typeof ProductOutcomeContractSchema>;
export type ProductOutcomeJourney = ProductOutcomeContract['journeys'][number];

function parsed<T>(schema: z.ZodType<T>, input: unknown): T {
  assertBounded(input);
  const result = schema.safeParse(input);
  if (!result.success) fail('CONTRACT_MALFORMED');
  return result.data;
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function assertUnique(values: readonly string[]): void {
  if (new Set(values).size !== values.length) fail('CONTRACT_RELATIONSHIP_INVALID');
}

function canonicalizeJourney(journey: ProductOutcomeJourney): ProductOutcomeJourney {
  return {
    ...journey,
    desiredOutcomeIds: uniqueSorted(journey.desiredOutcomeIds),
    assertions: [...journey.assertions].sort((left, right) => left.id.localeCompare(right.id)),
    requiredEvidence: [...journey.requiredEvidence]
      .map((requirement) => ({
        ...requirement,
        mediaTypes: uniqueSorted(requirement.mediaTypes),
      }))
      .sort((left, right) => left.id.localeCompare(right.id)),
    negativePaths: uniqueSorted(journey.negativePaths),
    limitations: uniqueSorted(journey.limitations),
  };
}

export function canonicalizeProductOutcomeContract(
  contract: ProductOutcomeContract,
): ProductOutcomeContract {
  return {
    ...contract,
    desiredOutcomeIds: uniqueSorted(contract.desiredOutcomeIds),
    scenarioIds: uniqueSorted(contract.scenarioIds),
    journeys: [...contract.journeys]
      .map(canonicalizeJourney)
      .sort((left, right) => left.scenarioId.localeCompare(right.scenarioId)),
  };
}

function assertInternalRelationships(contract: ProductOutcomeContract): void {
  assertUnique(contract.desiredOutcomeIds);
  assertUnique(contract.scenarioIds);
  assertUnique(contract.journeys.map(({ scenarioId }) => scenarioId));
  if (
    canonicalJson(uniqueSorted(contract.scenarioIds)) !==
    canonicalJson(uniqueSorted(contract.journeys.map(({ scenarioId }) => scenarioId)))
  ) {
    fail('CONTRACT_RELATIONSHIP_INVALID');
  }
  if (contract.syntheticUser && contract.evidenceAuthority !== 'test-only') {
    fail('SYNTHETIC_USER_AUTHORITY_INVALID');
  }
  const exercisedOutcomeIds = new Set<string>();
  const globalIds = new Set<string>();
  const addGlobal = (id: string): void => {
    if (globalIds.has(id)) fail('CONTRACT_RELATIONSHIP_INVALID');
    globalIds.add(id);
  };
  for (const journey of contract.journeys) {
    addGlobal(journey.scenarioId);
    assertUnique(journey.desiredOutcomeIds);
    assertUnique(journey.actions.map(({ actionId }) => actionId));
    assertUnique(journey.assertions.map(({ id }) => id));
    assertUnique(journey.requiredEvidence.map(({ id }) => id));
    assertUnique(journey.negativePaths);
    assertUnique(journey.limitations);
    for (const outcomeId of journey.desiredOutcomeIds) exercisedOutcomeIds.add(outcomeId);
    for (const { actionId } of journey.actions) addGlobal(actionId);
    for (const { id } of journey.assertions) addGlobal(id);
    for (const { id } of journey.requiredEvidence) addGlobal(id);
    if (
      (!journey.applicable && (journey.runnable || journey.stateReason === null)) ||
      (journey.applicable && journey.runnable && journey.stateReason !== null) ||
      (journey.applicable && !journey.runnable && journey.stateReason === null)
    ) {
      fail('JOURNEY_STATE_INVALID');
    }
    if (
      journey.applicable &&
      journey.runnable &&
      (journey.actions.length === 0 ||
        journey.assertions.length === 0 ||
        journey.requiredEvidence.length === 0)
    ) {
      fail('JOURNEY_STATE_INVALID');
    }
    const actionIds = new Set(journey.actions.map(({ actionId }) => actionId));
    for (const assertion of journey.assertions) {
      if (assertion.category !== 'subjective-game' && 'actionId' in assertion.subject) {
        if (!actionIds.has(assertion.subject.actionId)) fail('CONTRACT_RELATIONSHIP_INVALID');
      }
    }
    for (const requirement of journey.requiredEvidence) {
      assertUnique(requirement.mediaTypes);
      if (!actionIds.has(requirement.actionId)) fail('CONTRACT_RELATIONSHIP_INVALID');
    }
  }
  if (
    canonicalJson(uniqueSorted(contract.desiredOutcomeIds)) !==
    canonicalJson(uniqueSorted([...exercisedOutcomeIds]))
  ) {
    fail('CONTRACT_RELATIONSHIP_INVALID');
  }
}

function parseIntent(input: unknown): ProductIntent {
  try {
    return parseProductIntent(input);
  } catch {
    fail('INTENT_INVALID');
  }
}

function parseDescriptor(input: unknown): EnvironmentAciDescriptor {
  try {
    return parseEnvironmentAciDescriptor(input);
  } catch {
    fail('ENVIRONMENT_BINDING_INVALID');
  }
}

export function parseProductOutcomeContract(input: unknown): ProductOutcomeContract {
  const value = parsed(ProductOutcomeContractSchema, input) as ProductOutcomeContract;
  assertInternalRelationships(value);
  const canonical = canonicalizeProductOutcomeContract(value);
  const hashable = Object.fromEntries(
    Object.entries(canonical).filter(([key]) => key !== 'contractSha256'),
  );
  if (hashProductOutcomePayload(hashable) !== value.contractSha256) {
    fail('CONTRACT_DIGEST_INVALID');
  }
  return canonical;
}

export function validateProductOutcomeContractReferences(
  contractInput: unknown,
  intentInput: unknown,
  descriptorInput: unknown,
): ProductOutcomeContract {
  const contract = parseProductOutcomeContract(contractInput);
  const intent = parseIntent(intentInput);
  const descriptor = parseDescriptor(descriptorInput);

  if (
    contract.intent.intentId !== intent.intentId ||
    contract.intent.version !== intent.version ||
    contract.intent.hash !== intent.hash
  ) {
    fail('INTENT_BINDING_INVALID');
  }
  const outcomeIds = new Set(intent.desiredOutcomes.map(({ id }) => id));
  for (const outcomeId of contract.desiredOutcomeIds) {
    if (!outcomeIds.has(outcomeId)) fail('OUTCOME_REFERENCE_INVALID');
  }
  const scenarios = new Map(intent.scenarios.map((scenario) => [scenario.id, scenario]));
  for (const scenarioId of contract.scenarioIds) {
    if (!scenarios.has(scenarioId)) fail('SCENARIO_REFERENCE_INVALID');
  }
  if (
    contract.environment.adapterId !== descriptor.adapterId ||
    contract.environment.environmentId !== descriptor.environmentId ||
    contract.environment.sessionId !== descriptor.sessionId ||
    contract.environment.kind !== descriptor.kind ||
    contract.environment.environmentFingerprint !== descriptor.environmentFingerprint ||
    contract.environment.capabilityFingerprint !== descriptor.capabilityFingerprint
  ) {
    fail('ENVIRONMENT_BINDING_INVALID');
  }

  const contractedOutcomes = new Set(contract.desiredOutcomeIds);
  for (const journey of contract.journeys) {
    const scenario = scenarios.get(journey.scenarioId);
    if (!scenario) fail('SCENARIO_REFERENCE_INVALID');
    if (!PLATFORM_ENVIRONMENTS[descriptor.kind].includes(scenario.platform)) {
      fail('SCENARIO_PLATFORM_INVALID');
    }
    const scenarioOutcomes = new Set(scenario.outcomeIds);
    for (const outcomeId of journey.desiredOutcomeIds) {
      if (!contractedOutcomes.has(outcomeId) || !scenarioOutcomes.has(outcomeId)) {
        fail('OUTCOME_REFERENCE_INVALID');
      }
    }
    for (const action of journey.actions) {
      if (
        !ACTION_KIND_ENVIRONMENTS[action.kind].includes(descriptor.kind) ||
        !descriptor.actionKinds.includes(action.kind)
      ) {
        fail('ACTION_KIND_INVALID');
      }
    }
  }
  return contract;
}

export function createProductOutcomeContract(
  input: ProductOutcomeContractInput,
  intentInput: unknown,
  descriptorInput: unknown,
): ProductOutcomeContract {
  const parsedInput = parsed(ContractInputSchema, input);
  const intent = parseIntent(intentInput);
  const descriptor = parseDescriptor(descriptorInput);
  if (
    parsedInput.intent.intentId !== intent.intentId ||
    parsedInput.intent.version !== intent.version ||
    (parsedInput.intent.hash !== '0'.repeat(64) && parsedInput.intent.hash !== intent.hash)
  ) {
    fail('INTENT_BINDING_INVALID');
  }
  if (
    parsedInput.environment.adapterId !== descriptor.adapterId ||
    parsedInput.environment.environmentId !== descriptor.environmentId ||
    parsedInput.environment.sessionId !== descriptor.sessionId ||
    parsedInput.environment.kind !== descriptor.kind ||
    (parsedInput.environment.environmentFingerprint !== '0'.repeat(64) &&
      parsedInput.environment.environmentFingerprint !== descriptor.environmentFingerprint) ||
    (parsedInput.environment.capabilityFingerprint !== '0'.repeat(64) &&
      parsedInput.environment.capabilityFingerprint !== descriptor.capabilityFingerprint)
  ) {
    fail('ENVIRONMENT_BINDING_INVALID');
  }
  const intentOutcomeIds = new Set(intent.desiredOutcomes.map(({ id }) => id));
  if (parsedInput.desiredOutcomeIds.some((outcomeId) => !intentOutcomeIds.has(outcomeId))) {
    fail('OUTCOME_REFERENCE_INVALID');
  }
  const intentScenarioIds = new Set(intent.scenarios.map(({ id }) => id));
  if (parsedInput.scenarioIds.some((scenarioId) => !intentScenarioIds.has(scenarioId))) {
    fail('SCENARIO_REFERENCE_INVALID');
  }
  for (const journey of parsedInput.journeys) {
    for (const action of journey.actions) {
      if (
        !ACTION_KIND_ENVIRONMENTS[action.kind].includes(descriptor.kind) ||
        !descriptor.actionKinds.includes(action.kind)
      ) {
        fail('ACTION_KIND_INVALID');
      }
    }
  }
  const canonicalInput = canonicalizeProductOutcomeContract({
    schemaVersion: PRODUCT_OUTCOME_CONTRACT_SCHEMA_VERSION,
    ...parsedInput,
    intent: { intentId: intent.intentId, version: intent.version, hash: intent.hash },
    environment: {
      adapterId: descriptor.adapterId,
      environmentId: descriptor.environmentId,
      sessionId: descriptor.sessionId,
      kind: descriptor.kind,
      environmentFingerprint: descriptor.environmentFingerprint,
      capabilityFingerprint: descriptor.capabilityFingerprint,
    },
    contractSha256: '0'.repeat(64),
  } as ProductOutcomeContract);
  const hashable = Object.fromEntries(
    Object.entries(canonicalInput).filter(([key]) => key !== 'contractSha256'),
  );
  const sealed = {
    ...hashable,
    contractSha256: hashProductOutcomePayload(hashable),
  };
  return validateProductOutcomeContractReferences(sealed, intentInput, descriptorInput);
}
