import fs from 'node:fs';
import path from 'node:path';
import { IEventPublisher } from '../core/ports/IEventPublisher.js';
import { getWorkspaceRoot } from '../state/pipeline-manager.js';
import {
  evaluateClarificationGate,
  ProductIntent,
  ProductIntentCreateInput,
  ProductIntentValidationError,
  ProductDelta,
  projectLegacyGoals,
  StaleProductDeltaError,
} from './product-intent.js';
import {
  ProductIntentAlreadyInitializedError,
  ProductIntentEventDeliveryFailure,
  ProductIntentService,
} from './product-intent-service.js';

export const PRODUCT_INTENT_TOOL_NAMES = [
  'fw_get_product_intent',
  'fw_initialize_product_intent',
  'fw_apply_product_delta',
  'fw_get_product_goal_projection',
  'fw_evaluate_product_clarification',
] as const;

export type ProductIntentToolName = (typeof PRODUCT_INTENT_TOOL_NAMES)[number];

export interface ProductIntentToolResult {
  content: Array<{ type: 'text'; text: string }>;
  structuredContent: Record<string, unknown>;
}

export interface ProductIntentToolService {
  load(): Promise<ProductIntent | null>;
  initialize(input: ProductIntentCreateInput | ProductIntent): Promise<ProductIntent>;
  applyDelta(delta: ProductDelta | unknown): Promise<ProductIntent>;
  getLastEventDeliveryFailure(): Readonly<ProductIntentEventDeliveryFailure> | null;
}

export type ProductIntentToolServiceFactory = () => ProductIntentToolService;

export interface ProductIntentToolRuntime {
  execute(
    toolName: ProductIntentToolName,
    arguments_: Record<string, unknown>,
  ): Promise<ProductIntentToolResult>;
}

export type ProductIntentToolRuntimeFactory = () => ProductIntentToolRuntime;

const PRODUCT_INTENT_TOOL_ERROR_CODES = [
  'PRODUCT_INTENT_INVALID_ARGUMENTS',
  'PRODUCT_INTENT_ALREADY_INITIALIZED',
  'PRODUCT_INTENT_STALE_DELTA',
  'PRODUCT_INTENT_INVALID',
  'PRODUCT_INTENT_UNAVAILABLE',
] as const;
export type ProductIntentToolErrorCode = (typeof PRODUCT_INTENT_TOOL_ERROR_CODES)[number];

export class ProductIntentToolError extends Error {
  constructor(readonly code: ProductIntentToolErrorCode) {
    super(code);
    this.name = 'ProductIntentToolError';
  }
}

export function productIntentToolErrorCode(error: unknown): ProductIntentToolErrorCode {
  if (
    error instanceof ProductIntentToolError &&
    PRODUCT_INTENT_TOOL_ERROR_CODES.some((code) => code === error.code)
  ) {
    return error.code;
  }
  return 'PRODUCT_INTENT_UNAVAILABLE';
}

export function isProductIntentToolName(toolName: string): toolName is ProductIntentToolName {
  return PRODUCT_INTENT_TOOL_NAMES.some((name) => name === toolName);
}

export class ProductIntentEventLogPublisher implements IEventPublisher {
  private readonly workspace: string;
  private readonly directory: string;
  private readonly eventFile: string;

  constructor(workspacePath: string) {
    const workspace = path.resolve(workspacePath);
    const workspaceInfo = fs.lstatSync(workspace);
    if (
      workspaceInfo.isSymbolicLink() ||
      !workspaceInfo.isDirectory() ||
      workspace === path.parse(workspace).root
    ) {
      throw new Error('PRODUCT_INTENT_EVENT_WORKSPACE_INVALID');
    }
    this.workspace = fs.realpathSync(workspace);
    this.directory = path.join(this.workspace, '.forgewright');
    this.eventFile = path.join(this.directory, 'events.log');
    this.ensureContainedDirectory();
  }

  publish(eventName: string, payload: unknown): void {
    this.ensureContainedDirectory();
    if (fs.existsSync(this.eventFile)) {
      const eventInfo = fs.lstatSync(this.eventFile);
      if (eventInfo.isSymbolicLink() || !eventInfo.isFile()) {
        throw new Error('PRODUCT_INTENT_EVENT_TARGET_INVALID');
      }
    }

    const line = Buffer.from(
      `${JSON.stringify({ event: eventName, timestamp: Date.now(), payload })}\n`,
      'utf8',
    );
    let descriptor: number | undefined;
    try {
      descriptor = fs.openSync(
        this.eventFile,
        fs.constants.O_WRONLY |
          fs.constants.O_CREAT |
          fs.constants.O_APPEND |
          fs.constants.O_NOFOLLOW,
        0o600,
      );
      if (!fs.fstatSync(descriptor).isFile()) {
        throw new Error('PRODUCT_INTENT_EVENT_TARGET_INVALID');
      }
      const written = fs.writeSync(descriptor, line, 0, line.length, null);
      if (written !== line.length) throw new Error('PRODUCT_INTENT_EVENT_WRITE_INCOMPLETE');
      fs.fsyncSync(descriptor);
      const directoryDescriptor = fs.openSync(this.directory, fs.constants.O_RDONLY);
      try {
        fs.fsyncSync(directoryDescriptor);
      } finally {
        fs.closeSync(directoryDescriptor);
      }
    } finally {
      if (descriptor !== undefined) fs.closeSync(descriptor);
    }
  }

  private ensureContainedDirectory(): void {
    const workspaceInfo = fs.lstatSync(this.workspace);
    if (
      workspaceInfo.isSymbolicLink() ||
      !workspaceInfo.isDirectory() ||
      fs.realpathSync(this.workspace) !== this.workspace
    ) {
      throw new Error('PRODUCT_INTENT_EVENT_WORKSPACE_INVALID');
    }
    if (!fs.existsSync(this.directory)) {
      fs.mkdirSync(this.directory, { mode: 0o700 });
    }
    const directoryInfo = fs.lstatSync(this.directory);
    if (
      directoryInfo.isSymbolicLink() ||
      !directoryInfo.isDirectory() ||
      fs.realpathSync(this.directory) !== this.directory
    ) {
      throw new Error('PRODUCT_INTENT_EVENT_DIRECTORY_INVALID');
    }
  }
}

export function createProductIntentToolService(
  workspace: string = getWorkspaceRoot(),
): ProductIntentToolService {
  return ProductIntentService.forWorkspace(
    workspace,
    new ProductIntentEventLogPublisher(workspace),
  );
}

function assertStrictArguments(
  arguments_: Record<string, unknown>,
  allowed: readonly string[],
  required: readonly string[] = [],
): void {
  const keys = Object.keys(arguments_);
  if (
    keys.some((key) => !allowed.includes(key)) ||
    required.some((key) => !Object.prototype.hasOwnProperty.call(arguments_, key))
  ) {
    throw new ProductIntentToolError('PRODUCT_INTENT_INVALID_ARGUMENTS');
  }
}

function assertObjectArgument(value: unknown): asserts value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new ProductIntentToolError('PRODUCT_INTENT_INVALID_ARGUMENTS');
  }
}

function result(payload: Record<string, unknown>): ProductIntentToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
    structuredContent: payload,
  };
}

function eventDelivery(
  service: ProductIntentToolService,
  intent: ProductIntent,
): Record<string, unknown> {
  const failure = service.getLastEventDeliveryFailure();
  if (failure && failure.intentId === intent.intentId && failure.version === intent.version) {
    return {
      status: 'failed',
      code: 'PRODUCT_INTENT_EVENT_DELIVERY_FAILED',
      eventName: failure.eventName,
    };
  }
  return { status: 'delivered' };
}

function mutationResult(service: ProductIntentToolService, intent: ProductIntent) {
  return result({
    initialized: true,
    intent,
    version: intent.version,
    hash: intent.hash,
    eventDelivery: eventDelivery(service, intent),
  });
}

function stableError(error: unknown): never {
  if (error instanceof ProductIntentToolError) throw error;
  if (error instanceof ProductIntentAlreadyInitializedError) {
    throw new ProductIntentToolError('PRODUCT_INTENT_ALREADY_INITIALIZED');
  }
  if (error instanceof StaleProductDeltaError) {
    throw new ProductIntentToolError('PRODUCT_INTENT_STALE_DELTA');
  }
  if (error instanceof ProductIntentValidationError) {
    throw new ProductIntentToolError('PRODUCT_INTENT_INVALID');
  }
  throw new ProductIntentToolError('PRODUCT_INTENT_UNAVAILABLE');
}

export function createProductIntentToolRuntime(
  serviceFactory: ProductIntentToolServiceFactory = createProductIntentToolService,
): ProductIntentToolRuntime {
  return {
    async execute(toolName, arguments_) {
      try {
        const service = serviceFactory();
        if (toolName === 'fw_get_product_intent') {
          assertStrictArguments(arguments_, []);
          const intent = await service.load();
          return intent === null
            ? result({ initialized: false })
            : result({ initialized: true, intent });
        }
        if (toolName === 'fw_initialize_product_intent') {
          assertStrictArguments(arguments_, ['intent'], ['intent']);
          assertObjectArgument(arguments_.intent);
          const intent = await service.initialize(
            arguments_.intent as unknown as ProductIntentCreateInput | ProductIntent,
          );
          return mutationResult(service, intent);
        }
        if (toolName === 'fw_apply_product_delta') {
          assertStrictArguments(arguments_, ['delta'], ['delta']);
          assertObjectArgument(arguments_.delta);
          const intent = await service.applyDelta(arguments_.delta);
          return mutationResult(service, intent);
        }
        if (toolName === 'fw_get_product_goal_projection') {
          assertStrictArguments(arguments_, []);
          const intent = await service.load();
          return intent === null
            ? result({ initialized: false })
            : result({ initialized: true, projection: projectLegacyGoals(intent) });
        }
        assertStrictArguments(arguments_, ['userDirective']);
        if (
          arguments_.userDirective !== undefined &&
          typeof arguments_.userDirective !== 'string'
        ) {
          throw new ProductIntentToolError('PRODUCT_INTENT_INVALID_ARGUMENTS');
        }
        const intent = await service.load();
        return intent === null
          ? result({ initialized: false })
          : result({
              initialized: true,
              clarification: evaluateClarificationGate(
                intent.uncertainty,
                arguments_.userDirective,
              ),
            });
      } catch (error) {
        return stableError(error);
      }
    },
  };
}
