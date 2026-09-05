import { IEventPublisher } from '../core/ports/IEventPublisher.js';
import { IStateRepository } from '../core/ports/IStateRepository.js';
import {
  FileSystemStateRepository,
  FileSystemStateRepositoryOptions,
} from '../infrastructure/adapters/FileSystemStateRepository.js';
import {
  ProductDelta,
  ProductIntent,
  ProductIntentCreateInput,
  ProductIntentValidationError,
  applyProductDelta,
  createProductIntent,
  parseProductIntent,
} from './product-intent.js';

export const PRODUCT_INTENT_UPDATED_EVENT = 'PRODUCT_INTENT_UPDATED';

export interface ProductIntentEventDeliveryFailure {
  eventName: typeof PRODUCT_INTENT_UPDATED_EVENT;
  intentId: string;
  version: number;
  error: unknown;
}

export interface ProductIntentServiceDiagnostics {
  onEventDeliveryFailure?: (failure: ProductIntentEventDeliveryFailure) => void;
}

export class ProductIntentAlreadyInitializedError extends Error {
  constructor() {
    super('Product intent is already initialized. Use a ProductDelta to change current truth.');
    this.name = 'ProductIntentAlreadyInitializedError';
  }
}

/**
 * Owns the product-intent aggregate while delegating atomicity and persistence
 * to the repository port. Events are deliberately published only after the
 * repository transaction has committed.
 */
export class ProductIntentService {
  constructor(
    private readonly stateRepository: IStateRepository<ProductIntent>,
    private readonly eventPublisher: IEventPublisher,
    private readonly diagnostics: ProductIntentServiceDiagnostics = {},
  ) {}

  private lastEventDeliveryFailure: ProductIntentEventDeliveryFailure | null = null;

  static forWorkspace(
    workspacePath: string,
    eventPublisher: IEventPublisher,
    options: FileSystemStateRepositoryOptions = {},
    diagnostics: ProductIntentServiceDiagnostics = {},
  ): ProductIntentService {
    const repository = new FileSystemStateRepository<ProductIntent>(
      workspacePath,
      'product-intent.json',
      parseProductIntent,
      options,
    );
    return new ProductIntentService(repository, eventPublisher, diagnostics);
  }

  getLastEventDeliveryFailure(): Readonly<ProductIntentEventDeliveryFailure> | null {
    return this.lastEventDeliveryFailure;
  }

  private publishCommitted(state: ProductIntent): void {
    this.lastEventDeliveryFailure = null;
    try {
      this.eventPublisher.publish(PRODUCT_INTENT_UPDATED_EVENT, state);
    } catch (error) {
      const failure: ProductIntentEventDeliveryFailure = {
        eventName: PRODUCT_INTENT_UPDATED_EVENT,
        intentId: state.intentId,
        version: state.version,
        error,
      };
      this.lastEventDeliveryFailure = failure;
      try {
        this.diagnostics.onEventDeliveryFailure?.(failure);
      } catch {
        // Diagnostics are best-effort and must never obscure a durable commit.
      }
    }
  }

  async load(): Promise<ProductIntent | null> {
    const state = await this.stateRepository.load();
    return state === null ? null : parseProductIntent(state);
  }

  async initialize(input: ProductIntentCreateInput | ProductIntent): Promise<ProductIntent> {
    const initial =
      'schemaVersion' in input ? parseProductIntent(input) : createProductIntent(input);
    const committed = await this.stateRepository.transact((current) => {
      if (current !== null) throw new ProductIntentAlreadyInitializedError();
      return initial;
    });
    if (committed === null) {
      throw new ProductIntentValidationError(
        'Repository did not commit initialized product intent.',
      );
    }
    const verified = parseProductIntent(committed);
    this.publishCommitted(verified);
    return verified;
  }

  async applyDelta(delta: ProductDelta | unknown): Promise<ProductIntent> {
    const committed = await this.stateRepository.transact((current) => {
      if (current === null) {
        throw new ProductIntentValidationError(
          'Cannot apply a delta before product intent initialization.',
        );
      }
      return applyProductDelta(current, delta);
    });
    if (committed === null) {
      throw new ProductIntentValidationError('Repository did not commit product delta.');
    }
    const verified = parseProductIntent(committed);
    this.publishCommitted(verified);
    return verified;
  }
}
