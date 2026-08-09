---
name: sre
description: "Orchestrates system reliability engineering, performance benchmarking, containerized monitoring setups, CI/CD pipeline automation, and system SLO audits. Use when the user requests container setups (Docker), k6 load testing, deployment workflow configurations, dashboard metric monitoring, or system latency profiling."
version: 1.0.0
---

# Sre (LITE)

## SOLVE Step 2: GROUND (Sre Domain Slots)
| Assumption | Check command / file read | Result | Script-produced evidence |
|---|---|---|---|
| Active project tech stack and development profile are established | `cat .forgewright/project-profile.json` | ... | run the check command and paste output |
| Performance monitoring stack (k6/InfluxDB/Grafana) configurations exist | `find docker/perf-stack/ -name \"*.yml\" -o -name \"*.json\" \|\| ls -la docker-compose.test.yml` | ... | run the check command and paste output |
| Deployment and staged-rollout automation scripts exist | `find scripts/ci/ scripts/ -maxdepth 2 -type f 2>/dev/null` | ... | run the check command and paste output |

## SOLVE Step 3: DECOMPOSE (Sre Domain Slots)
Format: `n. ACTION | TARGET | CHECK`

1. AUDIT | Review deployment workflows, container structures, and monitoring endpoints | Ensure that health check thresholds, rate-limiting policies, and connection pool bounds are defined.
2. CONSTRUCT | Author robust k6 performance testing scripts, Docker configurations, or CI/CD pipelines | Verify that load test targets and deployment scripts compile without syntax errors.
3. BENCHMARK | Execute automated performance stress-tests and evaluate latency metrics | Confirm that system average latencies, error rates, and resource profiles stay within SLO budgets under simulated loads.

## Common Mistakes Checklist
- **Running High-Load Stress Tests Directly Against Production**: Triggering unthrottled k6 load tests directly against live production systems, risking unmanaged service denial.
- **Hardcoding Deployment Credentials & API Keys**: Embedding plain-text secrets, container registries passwords, or API tokens inside workflow files or docker-compose manifests instead of referencing secure secrets.
- **Unbounded Resource Allocation in Containers**: Failing to restrict container CPU and memory bounds inside Docker definitions, leading to host resource exhaustion under heavy test loads.
- **Non-Compliant File Names for Runbooks**: Storing deploy runbooks, incident reports, or benchmark logs under `docs/` using CamelCase or spaces instead of strictly lowercase kebab-case (e.g., `docs/05-operations/SreRunbook.md` instead of `docs/05-operations/sre-runbook.md`).

### Step 1: Ground target project settings and CI/CD benchmarks
```bash
cat .forgewright/project-profile.json
ls -la docker-compose.test.yml
```
```
-rw-r--r-- 1 sandbox sandbox 450 Jul  3 15:40 docker-compose.test.yml
```

### Step 2: Implement a safe, targeted k6 load testing script in `tests/performance/k6-load-test.js`
```javascript
import http from 'k6/http';
import { check, sleep } from 'k6';

// Grounded Rule: Define strict, realistic target SLO bounds for SLA verification
export const options = {
  stages: [
    { duration: '30s', target: 20 }, // Ramp up to 20 virtual users
    { duration: '1m', target: 20 },  // Stay at 20 users
    { duration: '10s', target: 0 },   // Ramp down
  ],
  thresholds: {
    http_req_duration: ['p(95)<500'], // 95% of requests must complete under 500ms
    http_req_failed: ['rate<0.01'],   // Error rate must be less than 1%
  },
};

export default function () {
  const res = http.get('http://localhost:8080/api/health');
  check(res, {
    'status is 200': (r) => r.status === 200,
  });
  sleep(1);
}
```

### Step 3: Spin up the local test stack and execute the k6 performance benchmark
```bash
# Start containerized target app via Docker Compose
docker-compose -f docker-compose.test.yml up -d

# Execute k6 load test runner
k6 run tests/performance/k6-load-test.js
```
