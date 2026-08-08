# Phase 2: Service Implementation

## Objective

Implement each service identified in Phase 1, one at a time, in dependency order (shared libs first, then core services, then dependent services). Follow clean architecture with thin handlers, pure service logic, and data-access repositories. Apply TDD per endpoint: write test, watch fail, implement, watch pass, refactor.

## 2.1 — Service Structure

Each service in `services/<service-name>/` follows clean architecture:

```
services/<service-name>/
├── src/
│   ├── handlers/           # API route handlers (thin — validate, delegate, respond)
│   │   ├── health.ts       # GET /healthz, GET /readyz
│   │   └── <resource>.ts   # CRUD + custom actions per resource
│   ├── services/           # Business logic (pure logic, no framework deps)
│   │   └── <resource>.service.ts
│   ├── repositories/       # Data access (DB queries, cache reads)
│   │   └── <resource>.repository.ts
│   ├── models/             # Domain models and DTOs
│   │   ├── entities/       # Database entity definitions
│   │   ├── dto/            # Request/Response DTOs (from OpenAPI schemas)
│   │   └── mappers/        # Entity <-> DTO transformations
│   ├── middleware/          # Auth, logging, rate limiting, tenant resolution
│   │   ├── auth.middleware.ts
│   │   ├── logging.middleware.ts
│   │   ├── rate-limit.middleware.ts
│   │   ├── tenant.middleware.ts
│   │   └── error-handler.middleware.ts
│   ├── config/             # Service configuration
│   │   ├── index.ts        # Env var loading with validation and defaults
│   │   ├── database.ts     # DB connection config
│   │   └── dependencies.ts # DI container wiring
│   ├── events/             # Event producers and consumers
│   │   ├── producers/
│   │   └── consumers/
│   └── index.ts            # Entry point — bootstrap, graceful shutdown
├── tests/
│   ├── unit/               # Pure logic tests (no I/O)
│   │   ├── services/
│   │   └── mappers/
│   ├── integration/        # Tests against real DB/cache (testcontainers)
│   │   └── repositories/
│   └── fixtures/           # Shared test data factories
├── Makefile                # build, test, lint, run, migrate
└── package.json / go.mod / requirements.txt / Cargo.toml  # (per language)
```

## 2.2 — Handler Implementation Pattern

Handlers are THIN. They validate input, delegate to services, and format output.

```
Handler receives request
  → Validate request (schema validation from OpenAPI DTOs)
  → Extract tenant context from middleware
  → Call service method with validated DTO
  → Service returns Result<DTO, DomainError>
  → Handler maps to HTTP response (200/201/400/404/500)
  → Structured logging of request/response metadata
```

Required for every handler:
- Request body validation against OpenAPI schema DTOs
- Request ID propagation (from `X-Request-ID` header or generate UUID)
- Structured logging with `trace_id`, `tenant_id`, `user_id`, `method`, `path`, `status`, `duration_ms`
- Error responses in the standard format: `{ code, message, details, trace_id }`
- Pagination support using cursor-based pagination for list endpoints

## 2.3 — Service Layer Implementation Pattern

Services contain ALL business logic. No HTTP awareness, no database awareness.

```
Service method receives validated DTO
  → Apply business rules and validation
  → Call repository for data access
  → Apply domain transformations
  → Emit domain events (if event-driven)
  → Return Result type (not exceptions for expected errors)
```

Required for every service:
- Constructor injection of repositories and dependencies (NO `new` in business logic)
- Domain error types (not HTTP errors — `NotFound`, `Conflict`, `ValidationFailed`, `Unauthorized`)
- Idempotency keys for all write operations
- Audit trail calls for state-changing operations (`who`, `what`, `when`, `tenant`)
- Unit testable in isolation with mocked repositories

## 2.4 — Repository Implementation Pattern

Repositories handle ALL data access. They return domain entities, not raw rows.

```
Repository method receives query parameters
  → Build query with tenant isolation (WHERE tenant_id = ?)
  → Execute with connection pool
  → Map rows to domain entities
  → Handle not-found as explicit return (Option/Maybe), not exception
  → Return domain entities
```

Required for every repository:
- Tenant-scoped queries (every query includes `tenant_id` filter)
- Soft delete support (`deleted_at IS NULL` in all queries)
- Connection pooling with health checks
- Query parameterization (NEVER string concatenation for SQL)
- Optimistic locking via `version` column for concurrent writes
- Read replica routing for read-heavy queries (when configured)

## 2.5 — Dependency Injection Wiring

Every service uses constructor injection. Wire dependencies in `config/dependencies.ts` (or equivalent):

```
// Pseudocode — adapt to chosen DI framework
Container.register({
  // Infrastructure
  dbPool: () => createPool(config.database),
  cache: () => createRedisClient(config.redis),
  eventBus: () => createEventBus(config.messageBroker),

  // Repositories
  userRepository: (c) => new UserRepository(c.dbPool, c.cache),
  orderRepository: (c) => new OrderRepository(c.dbPool, c.cache),

  // Services
  userService: (c) => new UserService(c.userRepository, c.eventBus),
  orderService: (c) => new OrderService(c.orderRepository, c.userService, c.eventBus),

  // Middleware
  authMiddleware: (c) => new AuthMiddleware(c.config.auth),
  tenantMiddleware: (c) => new TenantMiddleware(c.tenantRepository),
});
```

## 2.6 — Language-Specific Standards

### TypeScript/Node.js
- Strict TypeScript (`strict: true`, `noUncheckedIndexedAccess: true`)
- ESM modules, no CommonJS
- Zod or class-validator for runtime validation
- Drizzle, Prisma, or TypeORM for data access
- tsx or tsup for compilation
- pino for structured logging
- DI via tsyringe, inversify, or manual constructor injection

### Go
- Standard library HTTP or Chi/Gin/Fiber router
- sqlx or pgx for database access (not GORM for performance-critical paths)
- Wire or manual DI (no reflection-based DI)
- zerolog or slog for structured logging
- Context propagation for cancellation and tracing
- Table-driven tests

### Python
- FastAPI or Django REST Framework
- SQLAlchemy or Django ORM
- Pydantic for validation and serialization
- dependency-injector or manual DI
- structlog for structured logging
- pytest with fixtures

### Rust
- Axum or Actix-web
- SQLx for compile-time checked queries
- Tower middleware
- tracing crate for structured logging
- Manual DI via App state

### Java/Kotlin
- Spring Boot with constructor injection
- Spring Data JPA or jOOQ
- Spring Security for auth middleware
- SLF4J + Logback for structured logging
- JUnit 5 + Mockito for tests

## 2.7 — Config and Environment Variables

Every service loads config from environment variables with validation at startup:

```
# Required (fail to start if missing)
DATABASE_URL=postgresql://user:pass@host:5432/dbname
REDIS_URL=redis://host:6379
SERVICE_NAME=user-service
ENVIRONMENT=development|staging|production
LOG_LEVEL=debug|info|warn|error
PORT=8080

# Optional (with sensible defaults)
DB_POOL_MIN=2
DB_POOL_MAX=10
DB_QUERY_TIMEOUT_MS=5000
CACHE_TTL_SECONDS=300
RATE_LIMIT_RPM=100
GRACEFUL_SHUTDOWN_TIMEOUT_MS=30000

# Feature flags
FEATURE_FLAG_PROVIDER=env|launchdarkly|unleash
FEATURE_NEW_BILLING=false

# Auth
AUTH_JWKS_URL=https://auth.example.com/.well-known/jwks.json
AUTH_ISSUER=https://auth.example.com
AUTH_AUDIENCE=api.example.com

# Observability
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4317
OTEL_SERVICE_NAME=${SERVICE_NAME}

# Multi-tenancy
TENANT_ISOLATION_LEVEL=row|schema|database
```

Config must validate at startup and fail fast with clear error messages if required vars are missing.

## 2.8 — Payment System Integration

For SaaS products, implement payment infrastructure as a core service module (not an afterthought).

### Payment Service Structure
```
services/<payment-service>/
├── src/
│   ├── handlers/
│   │   ├── webhooks.ts          # Stripe/payment webhook handler
│   │   ├── subscriptions.ts     # Subscription CRUD
│   │   └── billing.ts           # Invoice, usage, billing portal
│   ├── services/
│   │   ├── payment-provider.ts  # Abstract payment provider interface
│   │   ├── stripe-provider.ts   # Stripe implementation
│   │   ├── subscription.ts      # Subscription lifecycle management
│   │   ├── billing.ts           # Metered billing, usage tracking
│   │   └── entitlements.ts      # Feature gating by plan
│   ├── repositories/
│   │   ├── subscription.ts      # Subscription persistence
│   │   ├── invoice.ts           # Invoice records
│   │   └── usage.ts             # Usage metering records
│   └── models/
│       ├── plan.ts              # Plan definitions (free, pro, enterprise)
│       ├── subscription.ts      # Subscription entity
│       └── invoice.ts           # Invoice entity
└── tests/
```

### Payment Standards
- **Provider abstraction** — Interface over Stripe/Paddle/LemonSqueezy so provider is swappable
- **Webhook idempotency** — Deduplicate by event ID, process exactly once
- **Webhook signature verification** — Always verify Stripe-Signature header
- **Subscription lifecycle** — Handle: created, updated, cancelled, past_due, unpaid, trial_ending
- **Entitlement system** — Feature access tied to plan, not hardcoded. Check `entitlements.canAccess(feature)` in middleware
- **Usage-based billing** — Track metered usage, report to billing provider, aggregate hourly
- **Invoice management** — Store invoice copies locally for compliance
- **Dunning flow** — Grace period, email reminders, downgrade, suspension
- **Tax handling** — Use Stripe Tax or TaxJar for automatic tax calculation
- **Multi-currency** — Support if serving international users
- **PCI compliance** — Never store card details. Use Stripe Elements / Checkout Sessions.
- **Billing portal** — Integrate Stripe Customer Portal or build custom

### Plan & Entitlement Configuration
```yaml
plans:
  free:
    price: 0
    features: [basic_feature]
    limits:
      api_calls: 100/day
      storage: 1GB
  pro:
    price: 29/month
    features: [basic_feature, advanced_feature, priority_support]
    limits:
      api_calls: 10000/day
      storage: 100GB
  enterprise:
    price: custom
    features: [all]
    limits:
      api_calls: unlimited
      storage: unlimited
```

## Validation Loop

Before moving to Phase 3:
- All services compile with zero errors and zero warnings
- Unit tests pass for all service layer and mapper logic
- Integration tests pass for repository layer against test DB
- Health checks work (`GET /healthz` returns 200, `GET /readyz` returns 200 when DB connected)
- API contract matches — all OpenAPI endpoints implemented, request/response schemas match

**After implementing all services, present code to user via notify_user for review before proceeding.**

## Quality Bar

| Gate | Check |
|------|-------|
| Compiles | `make build` passes with zero errors and zero warnings |
| Lint clean | `make lint` passes (ESLint/golangci-lint/ruff/clippy) |
| Unit tests pass | `make test-unit` — all service layer and mapper tests green |
| Integration tests pass | `make test-int` — repository tests against test DB green |
| Health check works | `GET /healthz` returns 200, `GET /readyz` returns 200 when DB connected |
| API contract match | All OpenAPI endpoints implemented, request/response schemas match |
| Tenant isolation (multi-tenant only) | Verify every tenant-scoped query/write enforces the project's actual tenant boundary; N/A for single-tenant systems |
| No hardcoded secrets | No API keys, passwords, or tokens in source code |
| Config validation | Service fails fast on startup if required env vars missing |
| Graceful shutdown | SIGTERM triggers connection draining, in-flight request completion |
