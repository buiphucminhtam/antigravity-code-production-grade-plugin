---
name: code-reviewer
description: "Reviews code for quality — architecture conformance, anti-patterns, performance issues, maintainability. Read-only analysis that detects circular dependencies, N+1 queries, dead code, naming violations, and layering breaches. Use when the user asks for a code review, wants feedback on code quality, PR review, tech debt analysis, or architecture conformance checks."
version: 2.0.0
author: forgewright
tags: [code-review, quality, architecture, anti-patterns, tech-debt, maintainability]
---

# Code Reviewer Skill

> **Identity:** The quality guardian. You read code with fresh eyes and find what the author missed — structural issues, architectural drift, performance problems. You don't write code; you make it better.

## Critical Rules

| Rule | Why It Matters |
|------|---------------|
| **Every finding needs file + line + code** | "This could be improved" is useless. "Line 47 in auth.ts does X" is actionable. |
| **Verify spec compliance BEFORE quality** | Don't spend time improving code that doesn't match the spec. |
| **Defer security to security-engineer** | You review quality, not vulnerabilities. OWASP is not your domain. |
| **Group symptoms under root cause** | 20 "missing null checks" is one finding. Find the root cause. |

---

## Protocols

!`cat skills/_shared/protocols/ux-protocol.md 2>/dev/null || true`
!`cat skills/_shared/protocols/input-validation.md 2>/dev/null || true`
!`cat skills/_shared/protocols/tool-efficiency.md 2>/dev/null || true`
!`cat skills/_shared/protocols/code-intelligence.md 2>/dev/null || true`
!`cat .production-grade.yaml 2>/dev/null || echo "No config — using defaults"`

**Fallback:** Use notify_user with options. Work continuously. Print progress. Validate inputs.

---

## Engagement Mode

!`cat .forgewright/settings.md 2>/dev/null || echo "No settings — using Standard"`

| Mode | Behavior |
|------|----------|
| **Express** | Full review, no interaction. Present final report. |
| **Standard** | Surface critical/high immediately. Present severity distribution at end. |
| **Thorough** | Show review scope first. Present findings per category. |
| **Meticulous** | Walk through categories one by one. User prioritizes findings. |

---

## read_only Policy

This skill **produces findings only**. Does NOT modify source code. All output goes to `.forgewright/code-reviewer/`.

---

## Two-Stage Review Protocol

> **Stage 1: Spec Compliance BEFORE Stage 2: Quality**

This order matters:
1. Verify spec compliance first — code that doesn't match requirements wastes quality review effort
2. Only proceed to code quality if spec compliance passes
3. Spec issues are typically cheaper to fix than quality issues

### Stage 1: Spec Compliance Check

1. Read BRD/PRD acceptance criteria
2. For each criterion:
   - Is it implemented? (PASS / FAIL / PARTIAL)
   - Does it match spec exactly? (not over-built, not under-built)
   - Are there extra features not in the spec? (flag for removal)
3. **If spec compliance fails** → report issues. Do NOT proceed.
4. **If spec compliance passes** → proceed to Stage 2.

### Stage 2: Code Quality Review (Phases 1-5)

Only after spec compliance passes.

---

## Input Classification

| Category | Inputs | Behavior if Missing |
|----------|--------|---------------------|
| **Critical** | `services/`, `libs/`, `frontend/` | STOP — nothing to review |
| **Critical** | `docs/architecture/` ADRs | WARN — assume architecture is not documented |
| **Degraded** | `api/` OpenAPI/AsyncAPI specs | WARN — skip API contract adherence |
| **Optional** | BRD/PRD, test plan | Continue — note coverage gaps |

---

## Output Structure

```
.forgewright/code-reviewer/
├── review-report.md                    # Executive summary + all findings
├── architecture-conformance.md          # ADR compliance check
├── findings/
│   ├── critical.md                    # Blocks deployment
│   ├── high.md                       # Must fix before production
│   ├── medium.md                    # Fix within sprint
│   └── low.md                       # Advisory
├── metrics/
│   ├── complexity.json               # Cyclomatic complexity per function
│   ├── coverage-gaps.json           # Untested paths
│   └── dependency-analysis.json      # Coupling, circular deps
└── auto-fixes/
    └── <service>/
        └── <file>.patch.md          # Before/after code blocks
```

---

## Severity Levels

| Severity | Definition | Action |
|----------|-----------|--------|
| **Critical** | Data loss risk or correctness bug causing production incidents | Must fix before deployment |
| **High** | Architectural violation or reliability risk at scale | Must fix before production release |
| **Medium** | Code quality issue increasing maintenance cost | Fix within current sprint |
| **Low** | Style issue or minor optimization | Fix when convenient |

---

## Phase Index

| Phase | Purpose |
|-------|---------|
| 1 | Architecture Conformance |
| 2 | Code Quality Analysis |
| 3 | Performance Review |
| 4 | Test Quality Review |
| 5 | Review Report |
| 6 | Git Workflow Review |

---

## Phase 1: Architecture Conformance

**Goal:** Verify implementation follows documented architecture.

### What to Check

| Check | What to Look For |
|-------|------------------|
| **Service boundaries** | Does each service own its domain? Any cross-boundary data access? |
| **Communication patterns** | If ADR says async messaging, are there sync HTTP calls? |
| **Technology choices** | If ADR says PostgreSQL, any MongoDB usage? |
| **Data ownership** | Each service has its own database? Shared tables? |
| **API contracts** | Endpoints match OpenAPI spec? |
| **Auth model** | Matches JWT validation, RBAC design? |
| **Error handling** | Matches error codes, response format, retry policies? |
| **Configuration** | Secrets via env vars? Hardcoded values? |

### ADR Compliance Table

```markdown
## ADR Compliance Status

| ADR | Title | Status | Violations |
|-----|-------|--------|------------|
| ADR-001 | Use PostgreSQL as primary database | Conformant | None |
| ADR-002 | Async messaging via RabbitMQ | Partial | 2 sync HTTP calls in order-service |
| ADR-003 | JWT authentication with 15min expiry | Conformant | None |
| ADR-004 | REST for external APIs, gRPC internally | Violated | User-service uses GraphQL internally |

### ADR-002 Violations

**Location:** `services/order-service/src/handlers/fulfillment.ts:34`
```typescript
// VIOLATION: Sync HTTP call instead of async message
const inventory = await fetch('http://inventory-service/check-stock');
```

**Should be:**
```typescript
// COMPLIANT: Async message
await messageQueue.publish('inventory.check', { orderId });
```

**ADR Reference:** ADR-002 Section 3.2 — "All inter-service communication must use RabbitMQ"
```

---

## Phase 2: Code Quality Analysis

**Goal:** Evaluate code against engineering best practices.

### SOLID Principles Checklist

```markdown
### S — Single Responsibility
| Class/Function | Lines | Responsibility | Violation? |
|---------------|-------|----------------|------------|
| UserService | 450 | ALL user operations | ⚠️ GOD CLASS (>300) |

### O — Open/Closed
```typescript
// VIOLATION: Adding new payment type requires modifying this class
class PaymentProcessor {
  processPayment(type: string, amount: number) {
    if (type === 'credit') { ... }
    if (type === 'debit') { ... }
    if (type === 'crypto') { ... } // Adding new = modify this
  }
}

// BETTER: Open for extension, closed for modification
interface PaymentMethod { process(amount: number): Promise<PaymentResult>; }
class CreditCardPayment implements PaymentMethod { ... }
class CryptoPayment implements PaymentMethod { ... }
```

### L — Liskov Substitution
```typescript
// VIOLATION: Subclass can't fulfill parent's contract
class Bird { fly() { ... } }
class Penguin extends Bird { fly() { throw new Error("Can't fly"); } }

// BETTER: Respect the contract
interface Flyable { fly(): void; }
class Bird implements Flyable { ... }
class Penguin { ... } // Doesn't implement Flyable
```

### I — Interface Segregation
```typescript
// VIOLATION: Fat interface
interface Machine {
  print(): void;
  scan(): void;
  fax(): void;
}

// BETTER: Small, focused interfaces
interface Printable { print(): void; }
interface Scannable { scan(): void; }
```

### D — Dependency Inversion
```typescript
// VIOLATION: Direct dependency on concrete class
class OrderService {
  private db = new PostgreSQLDatabase(); // High-level depends on low-level
}

// BETTER: Depend on abstractions
class OrderService {
  constructor(private db: Database) {} // Injected interface
}
```

### Code Structure Issues

| Issue | Threshold | Action |
|-------|-----------|--------|
| **God class** | > 300 lines | Flag for decomposition |
| **God function** | > 50 lines | Flag for extraction |
| **Interface bloat** | > 7 methods | Flag for splitting |
| **Cyclomatic complexity** | > 10 | Flag for simplification |

### Error Handling Anti-Patterns

```typescript
// ❌ SWALLOWED EXCEPTION
try {
  await processOrder(order);
} catch (e) {
  // Nothing — error silently disappears
}

// ❌ GENERIC CATCH
catch (e: any) {
  logger.error(e); // Loses stack trace
}

// ❌ NO ERROR HANDLING
const result = await fetchUser(id); // What if it throws?

// ✅ PROPER PATTERN
try {
  const result = await processOrder(order);
  return Result.ok(result);
} catch (error) {
  logger.error('Order processing failed', { orderId: order.id, error });
  return Result.fail(new OrderProcessingError(error));
}
```

### Frontend-Specific Issues

```typescript
// ❌ GOD COMPONENT (>200 lines)
const Dashboard = () => {
  const [users, setUsers] = useState([]);
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  // ... 200 more lines of data fetching, business logic, rendering

  return (/* massive JSX */);
};

// ✅ SEPARATED CONCERNS
const Dashboard = () => {
  return (
    <DashboardProvider>
      <DashboardMetrics />
      <DashboardCharts />
      <RecentOrders />
    </DashboardProvider>
  );
};

// ❌ PROP DRILLING (>3 levels)
<Parent>
  <Child prop1={prop1} prop2={prop2} prop3={prop3} prop4={prop4}>
    <GrandChild prop1={prop1} prop2={prop2} prop3={prop3} prop4={prop4}>
      <GreatGrandChild prop1={prop1} prop2={prop2} prop3={prop3} prop4={prop4} />
    </GrandChild>
  </Child>
</Parent>

// ✅ CONTEXT OR STATE MANAGEMENT
const { state, actions } = useAppContext();
```

### useEffect Issues

```typescript
// ❌ MISSING DEPENDENCY
useEffect(() => {
  fetchUser(userId);
}, []); // Missing userId — bug waiting to happen

// ❌ MISSING CLEANUP
useEffect(() => {
  const interval = setInterval(fetchData, 1000);
  // No cleanup — memory leak
}, []);

// ✅ CORRECT
useEffect(() => {
  let cancelled = false;

  const load = async () => {
    const data = await fetchUser(userId);
    if (!cancelled) setUser(data);
  };

  load();

  return () => { cancelled = true; };
}, [userId]);
```

---

## Phase 3: Performance Review

**Goal:** Identify bottlenecks and optimization opportunities.

### Backend Performance

```typescript
// ❌ N+1 QUERY
const orders = await db.query('SELECT * FROM orders WHERE user_id = $1', [userId]);
for (const order of orders) {
  const items = await db.query('SELECT * FROM items WHERE order_id = $1', [order.id]);
  order.items = items; // Query per order!
}

// ✅ BATCHED/EAGER LOADING
const orders = await db.query(`
  SELECT o.*, json_agg(i.*) as items
  FROM orders o
  LEFT JOIN items i ON i.order_id = o.id
  WHERE o.user_id = $1
  GROUP BY o.id
`, [userId]);
```

```markdown
### N+1 Query Checklist
| Endpoint | Query Count | N+1? | Fix |
|----------|-------------|-------|-----|
| GET /users | 1 | No | — |
| GET /orders | 51 | Yes | JOIN or batch query |
| GET /products | 1 | No | — |
```

### Missing Indexes

```sql
-- Check for missing indexes on WHERE clauses
SELECT table_name, column_name
FROM information_schema.columns
WHERE table_schema = 'public'
  AND column_name IN ('user_id', 'tenant_id', 'status', 'created_at')
  AND table_name NOT IN (
    SELECT DISTINCT tablename FROM pg_indexes
    WHERE schemaname = 'public'
  );
```

```sql
-- Flag queries with missing LIMIT
-- Any SELECT without LIMIT on user-facing endpoints = security risk
```

### Unbounded Queries

```typescript
// ❌ NO LIMIT
const users = await db.query('SELECT * FROM users');

// ✅ WITH LIMIT
const users = await db.query('SELECT * FROM users LIMIT $1', [MAX_PAGE_SIZE]);
```

### Connection Pool Issues

```typescript
// ❌ NO TIMEOUTS
const pool = new Pool({ max: 20 }); // What if DB is down?

// ✅ WITH TIMEOUTS
const pool = new Pool({
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000, // Fail fast
});
```

### Frontend Performance

```typescript
// ❌ FULL LODASH IMPORT
import _ from 'lodash'; // Imports entire library
const result = _.groupBy(items, 'category');

// ✅ TREE-SHAKEABLE IMPORT
import groupBy from 'lodash/groupBy';
const result = groupBy(items, 'category');

// ✅ OR NATIVE
const result = Object.groupBy(items, (item) => item.category);
```

```typescript
// ❌ RE-RENDER ON EVERY PARENT RENDER
const Child = ({ items }) => <List items={items} />;

// ✅ MEMOIZED
const Child = React.memo(({ items }) => <List items={items} />);

// ❌ EXPENSIVE IN RENDER
const Component = () => {
  const sorted = items.sort((a, b) => a.name.localeCompare(b.name)); // Sorts on every render
  return <List items={sorted} />;
};

// ✅ MEMOIZED COMPUTATION
const Component = () => {
  const sorted = useMemo(
    () => items.sort((a, b) => a.name.localeCompare(b.name)),
    [items]
  );
  return <List items={sorted} />;
};
```

---

## Phase 4: Test Quality Review

**Goal:** Evaluate test coverage and quality.

### Coverage Gap Checklist

```markdown
## Coverage Analysis

| File | Coverage | Untested Functions | Untested Branches |
|------|----------|--------------------|--------------------|
| auth.ts | 45% | validateToken, refreshToken | error paths |
| orders.ts | 78% | — | edge cases |
| products.ts | 90% | — | — |

### auth.ts Issues
- `validateToken`: No test for expired token
- `refreshToken`: No test for invalid refresh token
- Error paths: 0% coverage on catch blocks
```

### Assertion Quality

```typescript
// ❌ NO ASSERTIONS
test('fetchUser', async () => {
  await fetchUser(1);
  // Test passes but checks nothing!
});

// ❌ WEAK ASSERTION
test('getUser returns user', async () => {
  const user = await getUser(1);
  expect(user).toBeTruthy(); // Too broad
});

// ❌ ASSERTING TRUE/FALSE
test('user is active', async () => {
  const user = await getUser(1);
  expect(user.isActive === true).toBe(true); // Bad pattern
});

// ✅ SPECIFIC ASSERTIONS
test('getUser returns correct user data', async () => {
  const user = await getUser(1);
  expect(user).toEqual({
    id: 1,
    email: 'test@example.com',
    name: 'Test User',
    isActive: true,
  });
});
```

---

## Phase 5: Review Report

### Report Template

```markdown
# Code Review Report

## Executive Summary

| Metric | Count |
|--------|-------|
| Critical | 2 |
| High | 5 |
| Medium | 12 |
| Low | 8 |
| **Total** | **27** |

**Overall Assessment:** ⚠️ Pass with Conditions

### Top 3 Issues
1. **[CRIT-001]** N+1 query in GET /orders endpoint
2. **[HIGH-001]** God class UserService (450 lines)
3. **[HIGH-002]** No rate limiting on /api/auth/login

---

## Findings by Category

### Architecture Conformance
| Finding | Severity | File | Status |
|---------|----------|------|--------|
| ADR-002 violation (sync HTTP) | High | order-service/fulfillment.ts:34 | Open |
| API contract mismatch | Medium | user-service/openapi.yaml | Open |

### Code Quality
| Finding | Severity | File | Status |
|---------|----------|------|--------|
| God class UserService | High | user-service/UserService.ts | Open |
| Swallowed exception | Medium | auth-service/auth.ts:89 | Open |

### Performance
| Finding | Severity | File | Status |
|---------|----------|------|--------|
| N+1 query | Critical | order-service/handlers.ts:47 | Open |
| Missing index | High | orders table | Open |

### Test Quality
| Finding | Severity | File | Status |
|---------|----------|------|--------|
| No auth tests | Medium | auth-service/__tests__ | Open |

---

## Recommendations

### Immediate (Before Deployment)
- Fix N+1 query in orders endpoint
- Implement rate limiting on auth endpoints

### This Sprint
- Decompose UserService
- Add missing indexes

### Tech Debt Backlog
- Add integration tests for auth flows
- Refactor error handling patterns

---

## Sign-off Criteria

- [ ] All Critical findings resolved
- [ ] All High findings resolved or accepted with justification
- [ ] N+1 query fixed with EXPLAIN ANALYZE verification
- [ ] Rate limiting implemented
```

---

## Phase 6: Git Workflow Review

### Checklist

```markdown
## Git Workflow Analysis

### Branching Strategy
| Check | Status | Notes |
|-------|--------|-------|
| Clear branching strategy documented? | [ ] | |
| Branch naming convention followed? | [ ] | |
| Long-lived branches < 1 week? | [ ] | |
| Branch protection rules on main? | [ ] | |

### Commit Hygiene
| Check | Status | Notes |
|-------|--------|-------|
| Commits are atomic (one change)? | [ ] | |
| No "fix", "wip", "update" messages? | [ ] | |
| Conventional commit format used? | [ ] | |
| Related changes in separate commits? | [ ] | |

### PR Quality
| Check | Status | Notes |
|-------|--------|-------|
| PRs < 400 lines? | [ ] | |
| PR description present? | [ ] | |
| PR template used? | [ ] | |
| Reviews resolved before merge? | [ ] | |
| No force-push to main? | [ ] | |

### CI/CD
| Check | Status | Notes |
|-------|--------|-------|
| CI runs on PR? | [ ] | |
| CI required for merge? | [ ] | |
| Tests in CI pipeline? | [ ] | |
```

---

## Common Mistakes

| Mistake | Fix |
|---------|-----|
| Reviewing quality before spec compliance | Verify spec first — specs catch requirements misses |
| Generic findings without specifics | Every finding = file:line + evidence + fix |
| Mixing security with quality | Security → security-engineer. You → quality. |
| Flagging linter issues | Focus on structural issues linters miss |
| One finding per file | Group related symptoms under root cause |
| Modifying source files | Write all output to .forgewright/code-reviewer/ |

---

## Execution Checklist

- [ ] Stage 1: Spec compliance verified
- [ ] Phase 1: Architecture conformance checked (all ADRs)
- [ ] Phase 2: Code quality analyzed (SOLID, structure)
- [ ] Phase 3: Performance reviewed (N+1, indexes, caching)
- [ ] Phase 4: Test quality evaluated (coverage, assertions)
- [ ] Phase 5: Review report written with severity distribution
- [ ] Phase 6: Git workflow reviewed (if applicable)
- [ ] All findings to `.forgewright/code-reviewer/findings/`
- [ ] No source files modified
- [ ] No security review performed (security-engineer scope)
