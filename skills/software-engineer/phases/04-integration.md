# Phase 4: Integration Layer

## Objective

Implement service-to-service communication, event handling, external API clients, and database migration runner. This phase wires services together and connects them to external systems.

## 4.1 — Service-to-Service Communication

### Synchronous (REST/gRPC)

Generate typed HTTP clients for each service-to-service call:

```
// Auto-generated from OpenAPI specs
class UserServiceClient {
  constructor(baseUrl: string, httpClient: HttpClient, circuitBreaker: CircuitBreaker)

  async getUser(userId: string, tenantId: string): Promise<Result<UserDTO, ServiceError>>
  async createUser(dto: CreateUserDTO, tenantId: string): Promise<Result<UserDTO, ServiceError>>
}
```

Requirements:
- Generated from OpenAPI/gRPC specs (not hand-written)
- Circuit breaker wrapping all calls
- Request ID propagation (forward `X-Request-ID` from incoming request)
- Tenant context propagation (forward `X-Tenant-ID` header)
- Timeout per call (configurable, default 5s)
- Structured logging of outbound calls

### Asynchronous (Events)

Generate event producers and consumers from AsyncAPI specs:

**Producer pattern:**
```
Business operation completes
  → Create event envelope: { event_id, event_type, tenant_id, timestamp, payload, correlation_id }
  → Serialize (JSON/Avro/Protobuf per AsyncAPI spec)
  → Publish to topic/queue with retry
  → Log event published at INFO level
```

**Consumer pattern:**
```
Event received from topic/queue
  → Deserialize and validate schema
  → Check idempotency (event_id already processed?)
  → Extract tenant context from event envelope
  → Delegate to event handler service
  → Acknowledge message on success
  → On failure: retry with backoff, then dead-letter queue
  → Log event processed at INFO level
```

Event envelope standard:
```json
{
  "event_id": "uuid-v4",
  "event_type": "user.created",
  "event_version": "1.0",
  "source": "user-service",
  "tenant_id": "tenant-123",
  "correlation_id": "trace-abc",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "payload": { }
}
```

## 4.2 — External API Clients

For each third-party integration identified in the architecture:

```
libs/shared/clients/
├── stripe/
│   ├── client.ts           # Stripe SDK wrapper with retry/circuit breaker
│   ├── types.ts            # Mapped types (internal domain <-> Stripe types)
│   └── webhooks.ts         # Webhook signature verification + event handlers
├── sendgrid/
│   ├── client.ts
│   └── templates.ts        # Email template mappings
└── <provider>/
    ├── client.ts
    └── types.ts
```

Every external client must:
- Wrap the provider SDK (never use SDK directly in business logic)
- Map provider types to internal domain types
- Include circuit breaker and retry
- Handle webhook verification (if applicable)
- Log all outbound calls with duration and status
- Support mock/stub for testing

## 4.3 — Database Migration Runner

Implement a migration runner that executes the SQL migrations from `schemas/migrations/`:

```
migrate up    — Run all pending migrations in order
migrate down  — Rollback last migration
migrate status — Show applied vs pending migrations
```

Requirements:
- Migrations run in a transaction (rollback on failure)
- Migration lock (only one instance runs migrations at a time)
- Idempotent (safe to run multiple times)
- Logs each migration applied with duration

## Validation Loop

Before moving to Phase 5:
- Service-to-service clients compile and type-check against OpenAPI specs
- Event producers and consumers handle the full lifecycle (publish, consume, idempotency, dead-letter)
- External API clients define bounded timeout/failure behavior; add retry/circuit breaker only when retry semantics and failure impact justify them
- Migration runner can run up/down/status
- All integration tests pass

**After implementing all integration patterns, present to user via notify_user for review before proceeding.**

## Quality Bar

- Generate clients from authoritative specs when the project uses contract-first APIs; otherwise follow the established client pattern
- Remote calls have explicit timeout/failure semantics; retry/circuit breaker/idempotency are added only where the verified failure model requires them
- Event consumers are idempotent when duplicate delivery is possible
- Migration locking/transactions match the database and migration tool's actual guarantees
- Mock/stub external dependencies only where tests need isolation; do not create unused wrappers

## Context Bridging

| Architect Output (Project Root) | What This Phase Produces (Project Root) |
|--------------------------------|----------------------------------------|
| `api/openapi/*.yaml` | Typed service clients in `libs/shared/clients/` |
| `api/grpc/*.proto` | gRPC client implementations in `libs/shared/clients/` |
| `api/asyncapi/*.yaml` | Event producers/consumers in `services/*/src/events/` |
| `schemas/migrations/*.sql` | Migration runner in `scripts/migrate.sh` |

## Cloud-Specific Implementation Patterns

### AWS

| Concern | Implementation |
|---------|---------------|
| Database | Use AWS SDK v3 for DynamoDB, pg/mysql2 for RDS Aurora |
| Cache | ioredis for ElastiCache, DAX client for DynamoDB caching |
| Messaging | @aws-sdk/client-sqs + @aws-sdk/client-sns |
| Secrets | @aws-sdk/client-secrets-manager with caching (5-min TTL) |
| Storage | @aws-sdk/client-s3 with presigned URLs for uploads |
| Auth | Cognito JWT validation with `aws-jwt-verify` |
| Local dev | LocalStack for S3, SQS, SNS, Secrets Manager, DynamoDB |

### GCP

| Concern | Implementation |
|---------|---------------|
| Database | @google-cloud/spanner or pg for Cloud SQL |
| Cache | ioredis for Memorystore |
| Messaging | @google-cloud/pubsub |
| Secrets | @google-cloud/secret-manager with caching |
| Storage | @google-cloud/storage with signed URLs |
| Auth | Firebase Admin SDK or Google Auth Library |
| Local dev | GCP emulators (Pub/Sub, Firestore, Spanner) |

### Azure

| Concern | Implementation |
|---------|---------------|
| Database | @azure/cosmos or mssql for Azure SQL |
| Cache | ioredis for Azure Cache for Redis |
| Messaging | @azure/service-bus |
| Secrets | @azure/keyvault-secrets with caching |
| Storage | @azure/storage-blob with SAS tokens |
| Auth | @azure/identity + MSAL for Azure AD |
| Local dev | Azurite for Blob/Queue/Table storage |

### Multi-Cloud Abstraction

When multi-cloud support is needed, implement provider interfaces:

```
libs/shared/providers/
├── storage.provider.ts         # interface: upload, download, presign
│   ├── s3.storage.ts
│   ├── gcs.storage.ts
│   └── azure-blob.storage.ts
├── messaging.provider.ts       # interface: publish, subscribe, ack
│   ├── sqs.messaging.ts
│   ├── pubsub.messaging.ts
│   └── service-bus.messaging.ts
└── secrets.provider.ts         # interface: get, set, rotate
    ├── aws-sm.secrets.ts
    ├── gcp-sm.secrets.ts
    └── keyvault.secrets.ts
```

Select provider via config: `CLOUD_PROVIDER=aws|gcp|azure`. Wire in DI container.
