import path from 'node:path';

import {
  negotiateHarnessAdapter,
  type HarnessAdapter,
  type LifecycleOperation,
} from './harness-adapter.js';

export type VisualTaskClass = 'quick' | 'standard' | 'deep';
export type VisualRole = 'scout' | 'builder' | 'expert';
export type VisualReasoningEffort = 'low' | 'medium' | 'high' | 'max';
export type VisualMediaKind = 'image' | 'video';
export type VisualFeature = 'image_in' | 'video_in' | 'tool_use';

export interface VisualModelCapability {
  id: string;
  tiers: VisualRole[];
  features: VisualFeature[];
  reasoningEfforts: VisualReasoningEffort[];
}

export interface VisualCapabilityReport {
  status: 'available' | 'unavailable';
  source: string;
  models: VisualModelCapability[];
}

export interface VisualMediaInput {
  path: string;
  kind: VisualMediaKind;
  byteSize: number;
}

export interface VisualGameRequest {
  planDigest: string;
  objective: string;
  acceptanceCriteria: string[];
  taskClass: VisualTaskClass;
  role: VisualRole;
  modelId: string;
  reasoningEffort: VisualReasoningEffort;
  workerCount: number;
  media: VisualMediaInput[];
  swarmEnabled: boolean;
}

export interface VisualGamePlan {
  planDigest: string;
  objective: string;
  acceptanceCriteria: string[];
  taskClass: VisualTaskClass;
  role: VisualRole;
  modelSelection: {
    status: 'verified';
    modelId: string;
    capabilitySource: string;
    reasoningEffort: VisualReasoningEffort;
  };
  media: VisualMediaInput[];
  phases: ['inspect', 'plan', 'implement', 'render', 'compare', 'revise', 'audit'];
  loop: {
    maxIterations: number;
    timeoutMs: number;
    maxWorkers: number;
    swarmEnabled: false;
  };
}

export interface VisualInspectionResult {
  accepted: boolean;
  evidenceDigest: string;
  summary: string;
}

export interface VisualGameHarnessPort {
  adapter: HarnessAdapter;
  probeCapabilities(): Promise<VisualCapabilityReport>;
  inspectIteration(input: {
    sessionId: string;
    plan: VisualGamePlan;
    iteration: number;
  }): Promise<VisualInspectionResult>;
}

export interface VisualGameReceipt {
  planDigest: string;
  modelId: string;
  taskClass: VisualTaskClass;
  status: 'accepted' | 'iteration_cap_exhausted';
  iterationCount: number;
  evidenceDigests: string[];
  workerCount: number;
  swarmEnabled: false;
}

const SHA256 = /^[a-f0-9]{64}$/;
const SAFE_MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/;
const MAX_MEDIA_ITEMS = 8;
const MAX_MEDIA_ITEM_BYTES = 25 * 1024 * 1024;
const MAX_MEDIA_TOTAL_BYTES = 100 * 1024 * 1024;
const MAX_ACCEPTANCE_ITEMS = 32;
const MAX_TEXT_CHARS = 4_096;
const CLEANUP_TIMEOUT_MS = 5_000;
const PROFILES: Record<VisualTaskClass, { maxIterations: number; timeoutMs: number }> = {
  quick: { maxIterations: 1, timeoutMs: 30_000 },
  standard: { maxIterations: 2, timeoutMs: 90_000 },
  deep: { maxIterations: 3, timeoutMs: 180_000 },
};

export class VisualGameHarnessError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'VisualGameHarnessError';
  }
}

function requireText(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > MAX_TEXT_CHARS) {
    throw new VisualGameHarnessError(`invalid_${field}`);
  }
  return value.trim();
}

function validateMedia(media: VisualMediaInput[]): VisualMediaInput[] {
  if (!Array.isArray(media) || media.length === 0 || media.length > MAX_MEDIA_ITEMS) {
    throw new VisualGameHarnessError('invalid_media_count');
  }
  let totalBytes = 0;
  return media.map((item) => {
    if (!item || (item.kind !== 'image' && item.kind !== 'video')) {
      throw new VisualGameHarnessError('invalid_media_kind');
    }
    if (
      typeof item.path !== 'string' ||
      item.path.length === 0 ||
      path.posix.isAbsolute(item.path) ||
      item.path.includes('\\') ||
      item.path.split('/').includes('..')
    ) {
      throw new VisualGameHarnessError('unsafe_media_path');
    }
    if (
      !Number.isSafeInteger(item.byteSize) ||
      item.byteSize <= 0 ||
      item.byteSize > MAX_MEDIA_ITEM_BYTES
    ) {
      throw new VisualGameHarnessError('invalid_media_size');
    }
    totalBytes += item.byteSize;
    if (totalBytes > MAX_MEDIA_TOTAL_BYTES) {
      throw new VisualGameHarnessError('media_budget_exceeded');
    }
    return { ...item };
  });
}

function validateRequest(request: VisualGameRequest): VisualMediaInput[] {
  if (!SHA256.test(request.planDigest)) {
    throw new VisualGameHarnessError('invalid_plan_digest');
  }
  requireText(request.objective, 'objective');
  if (
    !Array.isArray(request.acceptanceCriteria) ||
    request.acceptanceCriteria.length === 0 ||
    request.acceptanceCriteria.length > MAX_ACCEPTANCE_ITEMS
  ) {
    throw new VisualGameHarnessError('invalid_acceptance_criteria');
  }
  request.acceptanceCriteria.forEach((criterion) => requireText(criterion, 'acceptance_criterion'));
  if (!(request.taskClass in PROFILES)) {
    throw new VisualGameHarnessError('invalid_task_class');
  }
  if (!['scout', 'builder', 'expert'].includes(request.role)) {
    throw new VisualGameHarnessError('invalid_role');
  }
  if (!SAFE_MODEL_ID.test(request.modelId)) {
    throw new VisualGameHarnessError('invalid_model_id');
  }
  if (!Number.isSafeInteger(request.workerCount) || request.workerCount < 1) {
    throw new VisualGameHarnessError('invalid_worker_count');
  }
  if (request.workerCount > 3) {
    throw new VisualGameHarnessError('worker_cap_exceeded');
  }
  if (request.swarmEnabled) {
    throw new VisualGameHarnessError('swarm_disabled');
  }
  return validateMedia(request.media);
}

function requiredOperations(profile: { maxIterations: number }): LifecycleOperation[] {
  return profile.maxIterations > 1 ? ['start', 'steer', 'interrupt'] : ['start', 'interrupt'];
}

function validateCapability(
  report: VisualCapabilityReport,
  request: VisualGameRequest,
  media: VisualMediaInput[],
): VisualModelCapability {
  if (
    report.status !== 'available' ||
    typeof report.source !== 'string' ||
    report.source.trim().length === 0 ||
    !Array.isArray(report.models)
  ) {
    throw new VisualGameHarnessError('capability_report_unavailable');
  }
  const model = report.models.find((candidate) => candidate.id === request.modelId);
  if (!model) throw new VisualGameHarnessError('selected_model_not_advertised');
  if (
    !Array.isArray(model.tiers) ||
    !Array.isArray(model.features) ||
    !Array.isArray(model.reasoningEfforts) ||
    !model.tiers.every((tier) => typeof tier === 'string') ||
    !model.features.every((feature) => typeof feature === 'string') ||
    !model.reasoningEfforts.every((effort) => typeof effort === 'string')
  ) {
    throw new VisualGameHarnessError('malformed_model_capability');
  }
  if (!model.tiers.includes(request.role)) {
    throw new VisualGameHarnessError(`required_tier_unavailable:${request.role}`);
  }
  const requiredFeatures = new Set<VisualFeature>(['tool_use']);
  if (media.some((item) => item.kind === 'image')) requiredFeatures.add('image_in');
  if (media.some((item) => item.kind === 'video')) requiredFeatures.add('video_in');
  for (const feature of requiredFeatures) {
    if (!model.features.includes(feature)) {
      throw new VisualGameHarnessError(`required_capability_unavailable:${feature}`);
    }
  }
  if (!model.reasoningEfforts.includes(request.reasoningEffort)) {
    throw new VisualGameHarnessError(
      `required_reasoning_effort_unavailable:${request.reasoningEffort}`,
    );
  }
  return model;
}

function validateInspection(value: VisualInspectionResult): VisualInspectionResult {
  if (!value || typeof value.accepted !== 'boolean' || !SHA256.test(value.evidenceDigest)) {
    throw new VisualGameHarnessError('invalid_inspection_result');
  }
  requireText(value.summary, 'inspection_summary');
  return value;
}

async function withinDeadline<T>(promise: Promise<T>, remainingMs: number): Promise<T> {
  if (remainingMs <= 0) throw new VisualGameHarnessError('visual_loop_timeout');
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(
          () => reject(new VisualGameHarnessError('visual_loop_timeout')),
          remainingMs,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export class VisualGameHarness {
  constructor(private readonly port: VisualGameHarnessPort) {}

  async plan(request: VisualGameRequest): Promise<VisualGamePlan> {
    const media = validateRequest(request);
    const profile = PROFILES[request.taskClass];
    negotiateHarnessAdapter(this.port.adapter, requiredOperations(profile));
    const report = await this.port.probeCapabilities();
    validateCapability(report, request, media);
    return {
      planDigest: request.planDigest,
      objective: request.objective.trim(),
      acceptanceCriteria: request.acceptanceCriteria.map((criterion) => criterion.trim()),
      taskClass: request.taskClass,
      role: request.role,
      modelSelection: {
        status: 'verified',
        modelId: request.modelId,
        capabilitySource: report.source,
        reasoningEffort: request.reasoningEffort,
      },
      media,
      phases: ['inspect', 'plan', 'implement', 'render', 'compare', 'revise', 'audit'],
      loop: {
        ...profile,
        maxWorkers: request.workerCount,
        swarmEnabled: false,
      },
    };
  }

  async run(request: VisualGameRequest): Promise<VisualGameReceipt> {
    const plan = await this.plan(request);
    const deadline = Date.now() + plan.loop.timeoutMs;
    const remaining = () => deadline - Date.now();
    const started = await withinDeadline(this.port.adapter.start(plan), remaining());
    if (!started || typeof started.sessionId !== 'string' || started.sessionId.length === 0) {
      throw new VisualGameHarnessError('invalid_session_id');
    }
    const evidenceDigests: string[] = [];
    try {
      for (let iteration = 1; iteration <= plan.loop.maxIterations; iteration++) {
        const inspection = validateInspection(
          await withinDeadline(
            this.port.inspectIteration({ sessionId: started.sessionId, plan, iteration }),
            remaining(),
          ),
        );
        evidenceDigests.push(inspection.evidenceDigest);
        if (inspection.accepted) {
          return {
            planDigest: plan.planDigest,
            modelId: plan.modelSelection.modelId,
            taskClass: plan.taskClass,
            status: 'accepted',
            iterationCount: iteration,
            evidenceDigests,
            workerCount: plan.loop.maxWorkers,
            swarmEnabled: false,
          };
        }
        if (iteration < plan.loop.maxIterations) {
          await withinDeadline(
            this.port.adapter.steer!({
              planDigest: plan.planDigest,
              iteration: iteration + 1,
              evidenceDigest: inspection.evidenceDigest,
              summary: inspection.summary,
            }),
            remaining(),
          );
        }
      }
      await withinDeadline(this.port.adapter.interrupt!(), CLEANUP_TIMEOUT_MS);
      return {
        planDigest: plan.planDigest,
        modelId: plan.modelSelection.modelId,
        taskClass: plan.taskClass,
        status: 'iteration_cap_exhausted',
        iterationCount: plan.loop.maxIterations,
        evidenceDigests,
        workerCount: plan.loop.maxWorkers,
        swarmEnabled: false,
      };
    } catch (error) {
      if (this.port.adapter.interrupt) {
        await withinDeadline(this.port.adapter.interrupt(), CLEANUP_TIMEOUT_MS).catch(
          () => undefined,
        );
      }
      throw error;
    }
  }
}
