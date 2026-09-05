import { createHash } from 'crypto';
import { z } from 'zod';

export const PRODUCT_INTENT_SCHEMA_VERSION = 'product-intent/v1' as const;
export const PRODUCT_DELTA_SCHEMA_VERSION = 'product-delta/v1' as const;
export const PRODUCT_INTENT_MAX_BYTES = 256 * 1024;

const MAX_ITEMS = 256;
const MAX_GRAPH_NODES = 512;
const MAX_GRAPH_EDGES = 2048;
const SHORT_TEXT_MAX = 256;
const TEXT_MAX = 4096;

export const SafeIdSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/, 'Expected a stable safe identifier.');
const ShortTextSchema = z.string().trim().min(1).max(SHORT_TEXT_MAX);
const TextSchema = z.string().trim().min(1).max(TEXT_MAX);
const IsoDateSchema = z.string().datetime({ offset: true });
const IdListSchema = z.array(SafeIdSchema).max(MAX_ITEMS);
const RefListSchema = z.array(SafeIdSchema).max(MAX_ITEMS);

export const AuthoritySourceSchema = z.enum([
  'current-explicit-user',
  'approved-project-truth',
  'current-workspace-evidence',
  'authoritative-research',
  'bounded-inference',
  'stale-memory',
  'model-prior',
]);
export type AuthoritySource = z.infer<typeof AuthoritySourceSchema>;

export const AUTHORITY_ORDER: readonly AuthoritySource[] = [
  'current-explicit-user',
  'approved-project-truth',
  'current-workspace-evidence',
  'authoritative-research',
  'bounded-inference',
] as const;

export const ProvenanceRecordSchema = z
  .object({
    id: SafeIdSchema,
    source: AuthoritySourceSchema,
    reference: TextSchema,
    observedAt: IsoDateSchema,
    current: z.boolean(),
    approved: z.boolean(),
  })
  .strict();
export type ProvenanceRecord = z.infer<typeof ProvenanceRecordSchema>;

const ProblemSchema = z
  .object({
    id: SafeIdSchema,
    statement: TextSchema,
    evidenceRefs: RefListSchema,
  })
  .strict();

const TargetActorSchema = z
  .object({
    id: SafeIdSchema,
    name: ShortTextSchema,
    description: TextSchema,
    evidenceRefs: RefListSchema,
  })
  .strict();

const JobToBeDoneSchema = z
  .object({
    id: SafeIdSchema,
    actorIds: IdListSchema.min(1),
    statement: TextSchema,
    desiredOutcomeIds: IdListSchema,
  })
  .strict();

const DesiredOutcomeSchema = z
  .object({
    id: SafeIdSchema,
    statement: TextSchema,
    acceptanceRefs: RefListSchema,
  })
  .strict();

const ConstraintSchema = z
  .object({
    id: SafeIdSchema,
    kind: z.enum(['technical', 'business', 'legal', 'platform', 'time', 'budget', 'other']),
    statement: TextSchema,
    evidenceRefs: RefListSchema,
  })
  .strict();

const NonGoalSchema = z
  .object({
    id: SafeIdSchema,
    statement: TextSchema,
    rationale: TextSchema,
  })
  .strict();

const PreferenceSchema = z
  .object({
    id: SafeIdSchema,
    key: ShortTextSchema,
    value: TextSchema,
    authorityRef: SafeIdSchema,
  })
  .strict();

export const ProductScenarioSchema = z
  .object({
    id: SafeIdSchema,
    name: ShortTextSchema,
    platform: z.enum(['web', 'mobile', 'game', 'cross-platform']),
    actorIds: IdListSchema.min(1),
    jobIds: IdListSchema,
    outcomeIds: IdListSchema.min(1),
    preconditions: z.array(TextSchema).max(64),
    steps: z.array(TextSchema).min(1).max(128),
    expectedOutcomes: z.array(TextSchema).min(1).max(64),
  })
  .strict();
export type ProductScenario = z.infer<typeof ProductScenarioSchema>;

export const UncertaintyRecordSchema = z
  .object({
    id: SafeIdSchema,
    statement: TextSchema,
    decisionImpact: z.enum(['outcome', 'cost', 'risk', 'public-contract', 'none']),
    evidenceRefs: RefListSchema,
    reversible: z.boolean(),
    safeDefault: TextSchema.nullable(),
    researchable: z.boolean(),
    owner: ShortTextSchema,
    resolutionState: z.enum(['unresolved', 'resolved', 'delegated']),
    resolution: TextSchema.nullable(),
    resolutionAuthorityRef: SafeIdSchema.nullable(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.resolutionState === 'resolved' && value.resolution === null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['resolution'],
        message: 'Resolved uncertainty requires a resolution.',
      });
    }
    if (value.resolutionState === 'resolved' && value.resolutionAuthorityRef === null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['resolutionAuthorityRef'],
        message: 'Resolved uncertainty requires a resolution authority.',
      });
    }
    if (value.resolutionState === 'unresolved' && value.resolution !== null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['resolution'],
        message: 'Unresolved uncertainty cannot carry a resolution.',
      });
    }
    if (value.resolutionState === 'unresolved' && value.resolutionAuthorityRef !== null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['resolutionAuthorityRef'],
        message: 'Unresolved uncertainty cannot carry a resolution authority.',
      });
    }
  });
export type UncertaintyRecord = z.infer<typeof UncertaintyRecordSchema>;

const DecisionSchema = z
  .object({
    id: SafeIdSchema,
    statement: TextSchema,
    rationale: TextSchema,
    authorityRef: SafeIdSchema,
    decidedAt: IsoDateSchema,
  })
  .strict();

const AcceptanceReferenceSchema = z
  .object({
    id: SafeIdSchema,
    statement: TextSchema,
    evidenceRef: ShortTextSchema.nullable(),
  })
  .strict();

export const ProductGoalNodeSchema = z
  .object({
    id: SafeIdSchema,
    type: z.enum(['outcome', 'capability', 'scenario', 'feature', 'evidence', 'metric']),
    statement: TextSchema,
    intentRef: SafeIdSchema.nullable(),
  })
  .strict()
  .superRefine((node, context) => {
    if (!['outcome', 'scenario'].includes(node.type) && node.intentRef !== null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['intentRef'],
        message: `${node.type} goal nodes cannot carry an untyped intentRef.`,
      });
    }
  });
export type ProductGoalNode = z.infer<typeof ProductGoalNodeSchema>;

export const ProductGoalEdgeSchema = z
  .object({
    id: SafeIdSchema,
    from: SafeIdSchema,
    to: SafeIdSchema,
  })
  .strict();
export type ProductGoalEdge = z.infer<typeof ProductGoalEdgeSchema>;

export const ProductGoalGraphSchema = z
  .object({
    nodes: z.array(ProductGoalNodeSchema).min(1).max(MAX_GRAPH_NODES),
    edges: z.array(ProductGoalEdgeSchema).max(MAX_GRAPH_EDGES),
  })
  .strict();
export type ProductGoalGraph = z.infer<typeof ProductGoalGraphSchema>;

const ProductIntentShape = {
  schemaVersion: z.literal(PRODUCT_INTENT_SCHEMA_VERSION),
  intentId: SafeIdSchema,
  version: z.number().int().min(1).max(1_000_000_000),
  hash: z.string().regex(/^[a-f0-9]{64}$/),
  createdAt: IsoDateSchema,
  updatedAt: IsoDateSchema,
  problem: ProblemSchema,
  targetActors: z.array(TargetActorSchema).min(1).max(MAX_ITEMS),
  jobsToBeDone: z.array(JobToBeDoneSchema).min(1).max(MAX_ITEMS),
  desiredOutcomes: z.array(DesiredOutcomeSchema).min(1).max(MAX_ITEMS),
  constraints: z.array(ConstraintSchema).max(MAX_ITEMS),
  nonGoals: z.array(NonGoalSchema).max(MAX_ITEMS),
  preferences: z.array(PreferenceSchema).max(MAX_ITEMS),
  scenarios: z.array(ProductScenarioSchema).min(1).max(MAX_ITEMS),
  uncertainty: z.array(UncertaintyRecordSchema).max(MAX_ITEMS),
  decisions: z.array(DecisionSchema).max(MAX_ITEMS),
  acceptanceRefs: z.array(AcceptanceReferenceSchema).min(1).max(MAX_ITEMS),
  provenance: z.array(ProvenanceRecordSchema).min(1).max(MAX_ITEMS),
  goalGraph: ProductGoalGraphSchema,
};

export const ProductIntentSchema = z.object(ProductIntentShape).strict();
export type ProductIntent = z.infer<typeof ProductIntentSchema>;
export type ProductIntentCreateInput = Omit<
  ProductIntent,
  'schemaVersion' | 'version' | 'hash' | 'createdAt' | 'updatedAt'
> & {
  createdAt: string;
};

const UpsertableCollectionSchema = z.enum([
  'targetActors',
  'jobsToBeDone',
  'desiredOutcomes',
  'constraints',
  'nonGoals',
  'preferences',
  'scenarios',
  'acceptanceRefs',
]);
type UpsertableCollection = z.infer<typeof UpsertableCollectionSchema>;

const UpsertItemOperationSchema = z.union([
  z
    .object({
      kind: z.literal('upsert-item'),
      collection: z.literal('targetActors'),
      value: TargetActorSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal('upsert-item'),
      collection: z.literal('jobsToBeDone'),
      value: JobToBeDoneSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal('upsert-item'),
      collection: z.literal('desiredOutcomes'),
      value: DesiredOutcomeSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal('upsert-item'),
      collection: z.literal('constraints'),
      value: ConstraintSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal('upsert-item'),
      collection: z.literal('nonGoals'),
      value: NonGoalSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal('upsert-item'),
      collection: z.literal('preferences'),
      value: PreferenceSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal('upsert-item'),
      collection: z.literal('scenarios'),
      value: ProductScenarioSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal('upsert-item'),
      collection: z.literal('acceptanceRefs'),
      value: AcceptanceReferenceSchema,
    })
    .strict(),
]);

export const ProductDeltaOperationSchema = z.union([
  z.object({ kind: z.literal('set-problem'), problem: ProblemSchema }).strict(),
  UpsertItemOperationSchema,
  z
    .object({
      kind: z.literal('remove-item'),
      collection: UpsertableCollectionSchema,
      id: SafeIdSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal('resolve-uncertainty'),
      id: SafeIdSchema,
      resolution: TextSchema,
      authorityRef: SafeIdSchema,
    })
    .strict(),
  z
    .object({ kind: z.literal('record-uncertainty'), uncertainty: UncertaintyRecordSchema })
    .strict(),
  z.object({ kind: z.literal('record-decision'), decision: DecisionSchema }).strict(),
  z.object({ kind: z.literal('record-provenance'), provenance: ProvenanceRecordSchema }).strict(),
  z.object({ kind: z.literal('replace-goal-graph'), goalGraph: ProductGoalGraphSchema }).strict(),
]);
export type ProductDeltaOperation = z.infer<typeof ProductDeltaOperationSchema>;

export const ProductDeltaSchema = z
  .object({
    schemaVersion: z.literal(PRODUCT_DELTA_SCHEMA_VERSION),
    deltaId: SafeIdSchema,
    intentId: SafeIdSchema,
    baseVersion: z.number().int().min(1).max(1_000_000_000),
    baseHash: z.string().regex(/^[a-f0-9]{64}$/),
    recordedAt: IsoDateSchema,
    operations: z.array(ProductDeltaOperationSchema).min(1).max(128),
  })
  .strict();
export type ProductDelta = z.infer<typeof ProductDeltaSchema>;

export class ProductIntentValidationError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ProductIntentValidationError';
  }
}

export class StaleProductDeltaError extends Error {
  constructor(message = 'Product delta base does not match current product truth.') {
    super(message);
    this.name = 'StaleProductDeltaError';
  }
}

export class AuthorityConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthorityConflictError';
  }
}

export function stableSafeId(namespace: string, value: string): string {
  const safeNamespace = namespace
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 16)
    .replace(/-+$/g, '');
  if (!safeNamespace) throw new ProductIntentValidationError('ID namespace must be non-empty.');
  const slug = value
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 30)
    .replace(/-+$/g, '');
  const digest = createHash('sha256')
    .update(`${namespace}\0${value}`, 'utf8')
    .digest('hex')
    .slice(0, 12);
  const id = `${safeNamespace}-${slug || 'item'}-${digest}`;
  const result = SafeIdSchema.safeParse(id);
  if (!result.success) throw new ProductIntentValidationError('Generated ID is not safe.');
  return result.data;
}

function byId<T extends { id: string }>(values: T[]): T[] {
  return [...values].sort((left, right) => left.id.localeCompare(right.id));
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

export function canonicalizeProductIntent(intent: ProductIntent): ProductIntent {
  return {
    ...intent,
    problem: { ...intent.problem, evidenceRefs: uniqueSorted(intent.problem.evidenceRefs) },
    targetActors: byId(
      intent.targetActors.map((actor) => ({
        ...actor,
        evidenceRefs: uniqueSorted(actor.evidenceRefs),
      })),
    ),
    jobsToBeDone: byId(
      intent.jobsToBeDone.map((job) => ({
        ...job,
        actorIds: uniqueSorted(job.actorIds),
        desiredOutcomeIds: uniqueSorted(job.desiredOutcomeIds),
      })),
    ),
    desiredOutcomes: byId(
      intent.desiredOutcomes.map((outcome) => ({
        ...outcome,
        acceptanceRefs: uniqueSorted(outcome.acceptanceRefs),
      })),
    ),
    constraints: byId(
      intent.constraints.map((constraint) => ({
        ...constraint,
        evidenceRefs: uniqueSorted(constraint.evidenceRefs),
      })),
    ),
    nonGoals: byId(intent.nonGoals),
    preferences: byId(intent.preferences),
    scenarios: byId(
      intent.scenarios.map((scenario) => ({
        ...scenario,
        actorIds: uniqueSorted(scenario.actorIds),
        jobIds: uniqueSorted(scenario.jobIds),
        outcomeIds: uniqueSorted(scenario.outcomeIds),
      })),
    ),
    uncertainty: byId(
      intent.uncertainty.map((record) => ({
        ...record,
        evidenceRefs: uniqueSorted(record.evidenceRefs),
      })),
    ),
    decisions: byId(intent.decisions),
    acceptanceRefs: byId(intent.acceptanceRefs),
    provenance: byId(intent.provenance),
    goalGraph: {
      nodes: byId(intent.goalGraph.nodes),
      edges: byId(intent.goalGraph.edges),
    },
  };
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

export function computeProductIntentHash(intent: ProductIntent): string {
  const canonical = canonicalizeProductIntent(intent);
  const { hash, ...hashable } = canonical;
  void hash;
  return createHash('sha256').update(canonicalJson(hashable), 'utf8').digest('hex');
}

function assertUniqueIds(label: string, values: Array<{ id: string }>): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value.id))
      throw new ProductIntentValidationError(`${label} contains duplicate id ${value.id}.`);
    seen.add(value.id);
  }
}

function assertRefs(label: string, refs: string[], available: Set<string>): void {
  if (new Set(refs).size !== refs.length) {
    throw new ProductIntentValidationError(`${label} contains duplicate references.`);
  }
  for (const ref of refs) {
    if (!available.has(ref))
      throw new ProductIntentValidationError(`${label} contains dangling reference ${ref}.`);
  }
}

const LEGAL_GRAPH_EDGES: Readonly<
  Record<ProductGoalNode['type'], readonly ProductGoalNode['type'][]>
> = {
  outcome: ['capability'],
  capability: ['scenario'],
  scenario: ['feature', 'evidence', 'metric'],
  feature: [],
  evidence: [],
  metric: [],
};

export function validateProductGoalGraph(graphInput: unknown): ProductGoalGraph {
  let graph: ProductGoalGraph;
  try {
    graph = ProductGoalGraphSchema.parse(graphInput);
  } catch (error) {
    const issue = error instanceof z.ZodError ? error.issues[0] : undefined;
    const detail = issue ? ` at ${issue.path.join('.') || 'root'}: ${issue.message}` : '';
    throw new ProductIntentValidationError(`Malformed Product Goal Graph${detail}.`, {
      cause: error,
    });
  }
  assertUniqueIds('goalGraph.nodes', graph.nodes);
  assertUniqueIds('goalGraph.edges', graph.edges);
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const adjacency = new Map<string, string[]>();
  const edgePairs = new Set<string>();
  const illegalEdges: string[] = [];
  for (const edge of graph.edges) {
    const from = nodes.get(edge.from);
    const to = nodes.get(edge.to);
    if (!from || !to) throw new ProductIntentValidationError(`Goal edge ${edge.id} is dangling.`);
    const pair = `${edge.from}\0${edge.to}`;
    if (edgePairs.has(pair))
      throw new ProductIntentValidationError(`Duplicate goal edge ${edge.from} -> ${edge.to}.`);
    edgePairs.add(pair);
    if (!LEGAL_GRAPH_EDGES[from.type].includes(to.type)) {
      illegalEdges.push(`${from.type} -> ${to.type}`);
    }
    adjacency.set(edge.from, [...(adjacency.get(edge.from) ?? []), edge.to]);
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (nodeId: string): void => {
    if (visiting.has(nodeId))
      throw new ProductIntentValidationError('Product Goal Graph contains a cycle.');
    if (visited.has(nodeId)) return;
    visiting.add(nodeId);
    for (const next of adjacency.get(nodeId) ?? []) visit(next);
    visiting.delete(nodeId);
    visited.add(nodeId);
  };
  for (const nodeId of nodes.keys()) visit(nodeId);
  if (illegalEdges.length > 0) {
    throw new ProductIntentValidationError(`Illegal goal edge ${illegalEdges[0]}.`);
  }
  return { nodes: byId(graph.nodes), edges: byId(graph.edges) };
}

function validateIntentRelationships(intent: ProductIntent): void {
  const collections: Array<[string, Array<{ id: string }>]> = [
    ['targetActors', intent.targetActors],
    ['jobsToBeDone', intent.jobsToBeDone],
    ['desiredOutcomes', intent.desiredOutcomes],
    ['constraints', intent.constraints],
    ['nonGoals', intent.nonGoals],
    ['preferences', intent.preferences],
    ['scenarios', intent.scenarios],
    ['uncertainty', intent.uncertainty],
    ['decisions', intent.decisions],
    ['acceptanceRefs', intent.acceptanceRefs],
    ['provenance', intent.provenance],
  ];
  for (const [label, values] of collections) assertUniqueIds(label, values);
  assertUniqueIds('Product intent globally unique entities', [
    intent.problem,
    ...collections.flatMap(([, values]) => values),
    ...intent.goalGraph.nodes,
    ...intent.goalGraph.edges,
  ]);
  const actors = new Set(intent.targetActors.map(({ id }) => id));
  const jobs = new Set(intent.jobsToBeDone.map(({ id }) => id));
  const outcomes = new Set(intent.desiredOutcomes.map(({ id }) => id));
  const acceptance = new Set(intent.acceptanceRefs.map(({ id }) => id));
  const provenance = new Set(intent.provenance.map(({ id }) => id));
  assertRefs('problem.evidenceRefs', intent.problem.evidenceRefs, provenance);
  for (const actor of intent.targetActors) {
    assertRefs(`targetActors.${actor.id}.evidenceRefs`, actor.evidenceRefs, provenance);
  }
  for (const job of intent.jobsToBeDone) {
    assertRefs(`jobsToBeDone.${job.id}.actorIds`, job.actorIds, actors);
    assertRefs(`jobsToBeDone.${job.id}.desiredOutcomeIds`, job.desiredOutcomeIds, outcomes);
  }
  for (const outcome of intent.desiredOutcomes) {
    assertRefs(`desiredOutcomes.${outcome.id}.acceptanceRefs`, outcome.acceptanceRefs, acceptance);
  }
  for (const preference of intent.preferences) {
    assertRefs(`preferences.${preference.id}.authorityRef`, [preference.authorityRef], provenance);
    const authority = intent.provenance.find(({ id }) => id === preference.authorityRef)!;
    if (!isEligibleAuthority(authority)) {
      throw new ProductIntentValidationError(
        `Preference ${preference.id} cites an ineligible authority.`,
      );
    }
  }
  for (const decision of intent.decisions) {
    assertRefs(`decisions.${decision.id}.authorityRef`, [decision.authorityRef], provenance);
    const authority = intent.provenance.find(({ id }) => id === decision.authorityRef)!;
    if (!isEligibleAuthority(authority)) {
      throw new ProductIntentValidationError(
        `Decision ${decision.id} cites an ineligible authority.`,
      );
    }
  }
  for (const constraint of intent.constraints) {
    assertRefs(`constraints.${constraint.id}.evidenceRefs`, constraint.evidenceRefs, provenance);
  }
  for (const record of intent.uncertainty) {
    assertRefs(`uncertainty.${record.id}.evidenceRefs`, record.evidenceRefs, provenance);
    if (record.resolutionAuthorityRef !== null) {
      assertRefs(
        `uncertainty.${record.id}.resolutionAuthorityRef`,
        [record.resolutionAuthorityRef],
        provenance,
      );
      const authority = intent.provenance.find(({ id }) => id === record.resolutionAuthorityRef)!;
      if (!isEligibleAuthority(authority)) {
        throw new ProductIntentValidationError(
          `Uncertainty ${record.id} cites an ineligible authority.`,
        );
      }
    }
  }
  for (const scenario of intent.scenarios) {
    assertRefs(`scenarios.${scenario.id}.actorIds`, scenario.actorIds, actors);
    assertRefs(`scenarios.${scenario.id}.jobIds`, scenario.jobIds, jobs);
    assertRefs(`scenarios.${scenario.id}.outcomeIds`, scenario.outcomeIds, outcomes);
  }
  const graph = validateProductGoalGraph(intent.goalGraph);
  const scenarioIds = new Set(intent.scenarios.map(({ id }) => id));
  for (const node of graph.nodes) {
    if (node.intentRef === null) continue;
    if (node.type === 'outcome')
      assertRefs(`goalGraph.nodes.${node.id}.intentRef`, [node.intentRef], outcomes);
    if (node.type === 'scenario')
      assertRefs(`goalGraph.nodes.${node.id}.intentRef`, [node.intentRef], scenarioIds);
  }
  const horizon = Date.parse(intent.updatedAt);
  for (const source of intent.provenance) {
    if (Date.parse(source.observedAt) > horizon) {
      throw new ProductIntentValidationError(
        `Provenance ${source.id} claims future evidence after product truth time.`,
      );
    }
  }
  for (const decision of intent.decisions) {
    if (Date.parse(decision.decidedAt) > horizon) {
      throw new ProductIntentValidationError(
        `Decision ${decision.id} claims a future decision after product truth time.`,
      );
    }
  }
}

function boundedBytes(value: unknown): number {
  try {
    return Buffer.byteLength(JSON.stringify(value), 'utf8');
  } catch (error) {
    throw new ProductIntentValidationError('Product intent must be finite JSON data.', {
      cause: error,
    });
  }
}

export function parseProductIntent(input: unknown): ProductIntent {
  if (boundedBytes(input) > PRODUCT_INTENT_MAX_BYTES) {
    throw new ProductIntentValidationError('Product intent exceeds its size limit.');
  }
  let parsed: ProductIntent;
  try {
    parsed = ProductIntentSchema.parse(input);
  } catch (error) {
    throw new ProductIntentValidationError('Malformed or unsupported product intent.', {
      cause: error,
    });
  }
  validateIntentRelationships(parsed);
  const canonical = canonicalizeProductIntent(parsed);
  if (Date.parse(canonical.updatedAt) < Date.parse(canonical.createdAt)) {
    throw new ProductIntentValidationError('Product intent updatedAt cannot precede createdAt.');
  }
  const expectedHash = computeProductIntentHash(canonical);
  if (canonical.hash !== expectedHash) {
    throw new ProductIntentValidationError('Product intent hash does not match canonical content.');
  }
  return canonical;
}

export function createProductIntent(input: ProductIntentCreateInput): ProductIntent {
  if (boundedBytes(input) > PRODUCT_INTENT_MAX_BYTES) {
    throw new ProductIntentValidationError('Product intent exceeds its size limit.');
  }
  let candidate: ProductIntent;
  try {
    candidate = ProductIntentSchema.parse({
      ...input,
      schemaVersion: PRODUCT_INTENT_SCHEMA_VERSION,
      version: 1,
      hash: '0'.repeat(64),
      updatedAt: input.createdAt,
    });
  } catch (error) {
    throw new ProductIntentValidationError('Malformed product intent input.', { cause: error });
  }
  validateIntentRelationships(candidate);
  const canonical = canonicalizeProductIntent(candidate);
  canonical.hash = computeProductIntentHash(canonical);
  return parseProductIntent(canonical);
}

export interface AuthorityCandidate<T> {
  id: string;
  source: AuthoritySource;
  value: T;
  observedAt: string;
  current: boolean;
  approved: boolean;
}

export interface AuthorityResolution<T> {
  value: T;
  authorityId: string;
  source: (typeof AUTHORITY_ORDER)[number];
}

const AuthorityCandidateSchema = z
  .object({
    id: SafeIdSchema,
    source: AuthoritySourceSchema,
    value: z.unknown(),
    observedAt: IsoDateSchema,
    current: z.boolean(),
    approved: z.boolean(),
  })
  .strict();
const AuthorityCandidateListSchema = z.array(AuthorityCandidateSchema).max(MAX_ITEMS);

function isEligibleAuthority(
  candidate: Pick<AuthorityCandidate<unknown>, 'source' | 'current' | 'approved'>,
): boolean {
  if (candidate.source === 'current-explicit-user') return candidate.current;
  if (candidate.source === 'approved-project-truth') return candidate.approved && candidate.current;
  if (candidate.source === 'current-workspace-evidence') return candidate.current;
  if (candidate.source === 'authoritative-research') return candidate.current;
  if (candidate.source === 'bounded-inference') return candidate.current;
  return false;
}

export function resolveAuthority<T>(
  candidates: readonly AuthorityCandidate<T>[],
): AuthorityResolution<T> | null {
  if (boundedBytes(candidates) > PRODUCT_INTENT_MAX_BYTES) {
    throw new ProductIntentValidationError('Authority candidates exceed their size limit.');
  }
  if (
    !Array.isArray(candidates) ||
    candidates.some(
      (candidate) =>
        typeof candidate !== 'object' ||
        candidate === null ||
        !Object.prototype.hasOwnProperty.call(candidate, 'value'),
    )
  ) {
    throw new ProductIntentValidationError('Authority candidates must be strict objects.');
  }
  let parsed: AuthorityCandidate<T>[];
  try {
    parsed = AuthorityCandidateListSchema.parse(candidates) as AuthorityCandidate<T>[];
  } catch (error) {
    throw new ProductIntentValidationError('Malformed authority candidates.', { cause: error });
  }
  const eligible = parsed.filter(isEligibleAuthority).map((candidate) => ({
    ...candidate,
    rank: AUTHORITY_ORDER.indexOf(candidate.source as (typeof AUTHORITY_ORDER)[number]),
    timestamp: Date.parse(candidate.observedAt),
  }));
  eligible.sort(
    (left, right) =>
      left.rank - right.rank || right.timestamp - left.timestamp || left.id.localeCompare(right.id),
  );
  const winner = eligible[0];
  if (!winner) return null;
  const tied = eligible.filter(
    (candidate) => candidate.rank === winner.rank && candidate.timestamp === winner.timestamp,
  );
  if (tied.some((candidate) => canonicalJson(candidate.value) !== canonicalJson(winner.value))) {
    throw new AuthorityConflictError('Equally authoritative current sources disagree.');
  }
  return {
    value: winner.value,
    authorityId: winner.id,
    source: winner.source as AuthorityResolution<T>['source'],
  };
}

export interface ClarificationGateResult {
  shouldAsk: boolean;
  questions: Array<{ uncertaintyId: string; question: string }>;
}

export function isExplicitDelegation(text: string): boolean {
  return /^(?:(?:please|kindly)\s*,?\s+)?(?:you decide|use your judgment|choose for me|pick for me)[.!?]*$/i.test(
    text.trim(),
  );
}

export function evaluateClarificationGate(
  uncertainty: readonly UncertaintyRecord[],
  userDirective = '',
): ClarificationGateResult {
  const delegated = isExplicitDelegation(userDirective);
  const questions = uncertainty
    .filter(
      (record) =>
        record.resolutionState === 'unresolved' &&
        record.decisionImpact !== 'none' &&
        !record.reversible &&
        record.safeDefault === null &&
        !record.researchable &&
        !delegated,
    )
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((record) => ({ uncertaintyId: record.id, question: record.statement }));
  return { shouldAsk: questions.length > 0, questions };
}

function parseProductDelta(input: unknown): ProductDelta {
  if (boundedBytes(input) > PRODUCT_INTENT_MAX_BYTES) {
    throw new ProductIntentValidationError('Product delta exceeds its size limit.');
  }
  try {
    return ProductDeltaSchema.parse(input);
  } catch (error) {
    throw new ProductIntentValidationError('Malformed or unsupported product delta.', {
      cause: error,
    });
  }
}

function collectionSchema(collection: UpsertableCollection): z.ZodTypeAny {
  return {
    targetActors: TargetActorSchema,
    jobsToBeDone: JobToBeDoneSchema,
    desiredOutcomes: DesiredOutcomeSchema,
    constraints: ConstraintSchema,
    nonGoals: NonGoalSchema,
    preferences: PreferenceSchema,
    scenarios: ProductScenarioSchema,
    acceptanceRefs: AcceptanceReferenceSchema,
  }[collection];
}

function upsertCollectionItem(
  intent: ProductIntent,
  collection: UpsertableCollection,
  raw: unknown,
): void {
  const value = collectionSchema(collection).parse(raw) as { id: string };
  const values = intent[collection] as Array<{ id: string }>;
  const index = values.findIndex((item) => item.id === value.id);
  if (index === -1) values.push(value);
  else values[index] = value;
}

function removeCollectionItem(
  intent: ProductIntent,
  collection: UpsertableCollection,
  id: string,
): void {
  const values = intent[collection] as Array<{ id: string }>;
  const index = values.findIndex((item) => item.id === id);
  if (index === -1)
    throw new ProductIntentValidationError(`Cannot remove missing ${collection} item ${id}.`);
  values.splice(index, 1);
}

export function applyProductDelta(currentInput: unknown, deltaInput: unknown): ProductIntent {
  const current = parseProductIntent(currentInput);
  const delta = parseProductDelta(deltaInput);
  if (
    delta.intentId !== current.intentId ||
    delta.baseVersion !== current.version ||
    delta.baseHash !== current.hash
  ) {
    throw new StaleProductDeltaError();
  }
  if (Date.parse(delta.recordedAt) < Date.parse(current.updatedAt)) {
    throw new StaleProductDeltaError('Product delta timestamp predates current product truth.');
  }
  const next = structuredClone(current);
  for (const operation of delta.operations) {
    switch (operation.kind) {
      case 'set-problem':
        next.problem = operation.problem;
        break;
      case 'upsert-item':
        upsertCollectionItem(next, operation.collection, operation.value);
        break;
      case 'remove-item':
        removeCollectionItem(next, operation.collection, operation.id);
        break;
      case 'resolve-uncertainty': {
        const record = next.uncertainty.find(({ id }) => id === operation.id);
        if (!record)
          throw new ProductIntentValidationError(
            `Cannot resolve missing uncertainty ${operation.id}.`,
          );
        if (record.resolutionState !== 'unresolved') {
          throw new ProductIntentValidationError(
            `Uncertainty ${operation.id} is already resolved.`,
          );
        }
        const authority = next.provenance.find(({ id }) => id === operation.authorityRef);
        if (!authority) {
          throw new ProductIntentValidationError(
            `Resolution authority ${operation.authorityRef} is dangling.`,
          );
        }
        if (!isEligibleAuthority(authority)) {
          throw new ProductIntentValidationError(
            `Resolution cites ineligible authority ${operation.authorityRef}.`,
          );
        }
        record.resolutionState = 'resolved';
        record.resolution = operation.resolution;
        record.resolutionAuthorityRef = operation.authorityRef;
        break;
      }
      case 'record-uncertainty':
        if (next.uncertainty.some(({ id }) => id === operation.uncertainty.id)) {
          throw new ProductIntentValidationError(
            `Uncertainty ${operation.uncertainty.id} already exists; history is append-only.`,
          );
        }
        next.uncertainty.push(operation.uncertainty);
        break;
      case 'record-decision':
        if (next.decisions.some(({ id }) => id === operation.decision.id)) {
          throw new ProductIntentValidationError(
            `Decision ${operation.decision.id} already exists; history is append-only.`,
          );
        }
        next.decisions.push(operation.decision);
        break;
      case 'record-provenance':
        if (next.provenance.some(({ id }) => id === operation.provenance.id)) {
          throw new ProductIntentValidationError(
            `Provenance ${operation.provenance.id} already exists; history is append-only.`,
          );
        }
        next.provenance.push(operation.provenance);
        break;
      case 'replace-goal-graph':
        next.goalGraph = validateProductGoalGraph(operation.goalGraph);
        break;
    }
  }
  next.version += 1;
  next.updatedAt = delta.recordedAt;
  next.hash = '0'.repeat(64);
  validateIntentRelationships(next);
  const canonical = canonicalizeProductIntent(next);
  canonical.hash = computeProductIntentHash(canonical);
  return parseProductIntent(canonical);
}

export interface LegacyGoalProjection {
  currentGoal: string;
  status: 'PLANNED';
  goals: Array<{
    id: string;
    kind: ProductGoalNode['type'];
    statement: string;
    dependsOn: string[];
  }>;
  phases: Array<{
    key: 'outcomes' | 'capabilities' | 'scenarios' | 'delivery';
    goalIds: string[];
  }>;
}

export function projectLegacyGoals(intentInput: unknown): Readonly<LegacyGoalProjection> {
  const intent = parseProductIntent(intentInput);
  const incoming = new Map<string, string[]>();
  for (const edge of intent.goalGraph.edges) {
    incoming.set(edge.to, [...(incoming.get(edge.to) ?? []), edge.from]);
  }
  const goals = intent.goalGraph.nodes.map((node) => ({
    id: node.id,
    kind: node.type,
    statement: node.statement,
    dependsOn: uniqueSorted(incoming.get(node.id) ?? []),
  }));
  const phase = (types: ProductGoalNode['type'][]): string[] =>
    goals.filter((goal) => types.includes(goal.kind)).map(({ id }) => id);
  const projection: LegacyGoalProjection = {
    currentGoal: intent.problem.statement,
    status: 'PLANNED' as const,
    goals: goals.map((goal) =>
      Object.freeze({ ...goal, dependsOn: Object.freeze(goal.dependsOn) as unknown as string[] }),
    ),
    phases: [
      { key: 'outcomes' as const, goalIds: phase(['outcome']) },
      { key: 'capabilities' as const, goalIds: phase(['capability']) },
      { key: 'scenarios' as const, goalIds: phase(['scenario']) },
      { key: 'delivery' as const, goalIds: phase(['feature', 'evidence', 'metric']) },
    ],
  };
  projection.phases = projection.phases.map((item) =>
    Object.freeze({ ...item, goalIds: Object.freeze(item.goalIds) as unknown as string[] }),
  );
  Object.freeze(projection.goals);
  Object.freeze(projection.phases);
  return Object.freeze(projection);
}
