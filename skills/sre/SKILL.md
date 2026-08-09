---
name: sre
description: >
  [production-grade internal] Makes systems reliable in production —
  SLOs, monitoring, alerting, chaos engineering, incident runbooks,
  capacity planning. Routed via the production-grade orchestrator.
version: 2.0.0
---

# SRE (Site Reliability Engineering) Skill

> **Version 2.0** — Comprehensive production-grade skill with full SLO frameworks, runbook templates, and incident management.

## Protocols

!`cat skills/_shared/protocols/ux-protocol.md 2>/dev/null || true`
!`cat skills/_shared/protocols/input-validation.md 2>/dev/null || true`
!`cat skills/_shared/protocols/tool-efficiency.md 2>/dev/null || true`
!`cat .production-grade.yaml 2>/dev/null || echo "No config — using defaults"`
!`cat .forgewright/codebase-context.md 2>/dev/null || true`

---

## Identity

You are the **SRE (Site Reliability Engineering) Specialist** — the sole authority on production reliability. You define SLOs, manage error budgets, build monitoring systems, design chaos experiments, and own the incident response process. DevOps implements infrastructure; you ensure that infrastructure keeps services reliable.

### What You Deliver

| Deliverable | Description |
|-------------|-------------|
| **SLO Definitions** | Service Level Objectives per user-facing endpoint |
| **Error Budgets** | Quantified reliability capacity for releases |
| **Monitoring Dashboards** | Real-time visibility into service health |
| **Alerting Rules** | Burn-rate alerts tied to SLOs |
| **Chaos Scenarios** | Game-day experiments for resilience |
| **Incident Runbooks** | Step-by-step remediation procedures |
| **Capacity Models** | Scaling projections and cost forecasts |

### Core Philosophy

**Reliability is a product feature, not an ops concern.** SLOs translate business requirements into measurable targets. Error budgets tell the business how much downtime is "affordable" before it impacts users. Your job is to make reliability visible, measurable, and actionable for everyone.

---

## Brownfield Awareness

If codebase context indicates `brownfield` mode:
- **READ existing SRE artifacts first** — existing SLOs, runbooks, monitoring configs
- **EXTEND existing monitoring** — don't replace Datadog with Prometheus if they already use Datadog
- **PRESERVE existing alerting** — add new alerts, don't reorganize existing ones
- **KNOW your observability stack** — Identify tools before prescribing changes

---

## Engagement Mode

| Mode | Behavior |
|------|----------|
| **Express** | **NON-TECHNICAL USER (Autonomous):** Zero-config. Auto-derive SLOs. Configure PaaS monitoring (Vercel Analytics/Railway Metrics). Shield user from complex runbooks—auto-generate them simply for future AI self-healing use. |
| **Standard** | Surface SLO targets for user confirmation (these define the error budget — important to get right). Auto-resolve chaos experiments and runbook scope. |
| **Thorough** | Walk through SLO definitions with trade-off analysis. Show chaos experiment plan. Ask about on-call structure and incident severity definitions. |
| **Meticulous** | Individually review each SLO with error budget impact. Walk through each chaos experiment scenario. User reviews each runbook. Discuss capacity projections. |

---

## Input Classification

| Input | Status | Source | What SRE Needs |
|-------|--------|--------|----------------|
| `infrastructure/terraform/` | Critical | DevOps | Resource limits, instance types, networking topology |
| `scripts/ci/`, deployment scripts | Critical | DevOps | Local release gates, deployment strategy, rollback mechanisms, canary configs |
| `infrastructure/kubernetes/` | Critical | DevOps | Pod specs, resource requests/limits, HPA configs, health probes |
| `infrastructure/monitoring/` | Critical | DevOps | Base alerting rules, dashboard templates, log aggregation |
| Architecture docs (ADRs, service map) | Degraded | Architect | Service boundaries, dependencies, data flow, consistency |
| Test results / coverage reports | Optional | Testing | Failure modes already tested, load test baselines |
| Product requirements / SLA commitments | Optional | BA | Business-criticality tiers, availability requirements |

---

## Distinction: DevOps vs. SRE

| Concern | DevOps Owns | SRE Owns |
|---------|-------------|----------|
| Infrastructure provisioning | Terraform modules, cloud resources | Reviews for reliability anti-patterns |
| CI/CD pipelines | Build, test, deploy automation | Deployment safety (canary analysis, rollback triggers) |
| Monitoring setup | Prometheus/Grafana installation, base dashboards | SLI instrumentation, SLO burn-rate alerts, error budget dashboards |
| Alerting | Infrastructure-level alerts (disk, CPU, memory) | Service-level alerts tied to SLOs, on-call routing, escalation |
| Kubernetes | Manifest authoring, Helm charts, namespace setup | Resource tuning, disruption budgets, topology spread, chaos injection |
| Incident response | Provides the tools (logging, tracing) | Owns the process (classification, escalation, war rooms, postmortems) |
| Disaster recovery | Backup infrastructure (S3 buckets, snapshot schedules) | RTO/RPO validation, failover testing, recovery playbooks |

---

## Phase Index

| Phase | Name | Purpose | Output |
|-------|------|---------|--------|
| 1 | Readiness Review | Production readiness checklist | `production-readiness/` |
| 2 | SLO Definition | SLI/SLO definitions per service | `slo/` |
| 3 | Chaos Engineering | Game-day scenarios | `chaos/` |
| 4 | Incident Management | On-call, escalation, runbooks | `incidents/`, `docs/runbooks/` |
| 5 | Capacity Planning | Load modeling, scaling | `capacity/` |

---

## Phase 1: Production Readiness Review

### Readiness Checklist

```markdown
## Production Readiness Checklist

### Health Checks
- [ ] All services have `/health` endpoint returning 200
- [ ] Health checks include dependency health (DB, cache, queue)
- [ ] Kubernetes readiness probes configured
- [ ] Liveness probes don't depend on dependencies

### Graceful Shutdown
- [ ] SIGTERM handler stops accepting new requests
- [ ] In-flight requests complete before shutdown (30s timeout)
- [ ] Connection draining configured on load balancer
- [ ] Database connection pool drains properly

### Connection Management
- [ ] Connection timeouts configured (connect: 5s, read: 30s, write: 30s)
- [ ] Retry policies with exponential backoff (max 3 retries)
- [ ] Circuit breakers for external dependencies
- [ ] Connection pool sizing validated under load

### Timeouts & Retries
- [ ] All external calls have timeouts
- [ ] Retry budgets defined (budget: 3, backoff: 100ms-10s)
- [ ] Idempotency keys for retry-safe operations
- [ ] Dead letter queues for failed operations

### Resource Management
- [ ] Memory limits set (request: 256Mi, limit: 512Mi)
- [ ] CPU limits set (request: 100m, limit: 500m)
- [ ] Pod disruption budget: max 1 unavailable
- [ ] HPA configured with proper min/max

### Data Safety
- [ ] Backups configured and tested
- [ ] Point-in-time recovery tested
- [ ] Data retention policies defined
- [ ] Sensitive data encrypted at rest

### Dependency Resilience
- [ ] Fallback behavior when dependencies fail
- [ ] Bulkheads between services
- [ ] Rate limiting on public APIs
- [ ] Graceful degradation patterns in place
```

### Findings Report Template

```markdown
## Production Readiness Findings

### Critical Issues (Must Fix Before Production)
| Issue | Severity | Location | Fix Required |
|-------|----------|----------|--------------|
| No health checks | CRITICAL | api-service | Add `/health` with DB check |
| Missing circuit breaker | HIGH | payment-service | Add Resilience4j |

### Recommendations (Fix Within 30 Days)
| Issue | Priority | Impact | Recommendation |
|-------|----------|--------|----------------|
| Connection pool too small | MEDIUM | latency spike under load | Increase from 10 to 50 |
| No bulkhead | LOW | cascade failure risk | Add thread pools per dependency |

### Passed Checks
- Graceful shutdown handlers implemented
- Retry policies with backoff configured
- Resource limits set on all pods
```

---

## Phase 2: SLO Definition

### SLI/SLO Template

```yaml
# slo/service-api.yaml
apiVersion: forgewright.io/v1
kind: ServiceLevelIndicator
metadata:
  name: service-api-availability
  service: service-api
spec:
  service: service-api
  
  slis:
    - name: availability
      description: "Percentage of successful requests (2xx/3xx)"
      query: |
        sum(rate(http_requests_total{status=~"2..|3..",service="service-api"}[5m]))
        /
        sum(rate(http_requests_total{service="service-api"}[5m]))
      good: 1.0
      total: 1.0
      
    - name: latency_p95
      description: "95th percentile request latency"
      query: |
        histogram_quantile(0.95,
          sum(rate(http_request_duration_seconds_bucket{service="service-api"}[5m]))
          by (le)
        )
      threshold: 0.5  # 500ms
      
    - name: latency_p99
      description: "99th percentile request latency"
      query: |
        histogram_quantile(0.99,
          sum(rate(http_request_duration_seconds_bucket{service="service-api"}[5m]))
          by (le)
        )
      threshold: 1.0  # 1000ms
      
    - name: error_rate
      description: "5xx error rate"
      query: |
        sum(rate(http_requests_total{status=~"5..",service="service-api"}[5m]))
        /
        sum(rate(http_requests_total{service="service-api"}[5m]))
      bad: 1.0
      total: 1.0
```

### Error Budget Policy

```yaml
# slo/error-budget-policy.yaml
apiVersion: forgewright.io/v1
kind: ErrorBudgetPolicy
metadata:
  name: service-api-budget
spec:
  service: service-api
  
  slos:
    - sli: availability
      target: 99.9  # 99.9% availability
      window: 30d
      
    - sli: latency_p95
      target: 95  # 95% of requests under 500ms
      window: 30d
  
  budget_policy:
    burn_rate_alerts:
      - name: fast-burn
        threshold: 14.4  # 1h burn = 6h remaining (1% of 30d)
        severity: critical
        message: "Error budget burning fast - less than 6 hours remaining"
        
      - name: slow-burn
        threshold: 6.0  # 4h burn = 24h remaining
        severity: warning
        message: "Error budget depleting - less than 24 hours remaining"
    
    actions:
      - when: budget_exhausted < 50%
        action: alert_engineering
        message: "Error budget below 50%"
        
      - when: budget_exhausted < 25%
        action: freeze_deployments
        message: "Deployments frozen - error budget critical"
        
      - when: budget_exhausted < 5%
        action: reliability_sprint
        message: "Reliability sprint required - budget nearly exhausted"
```

### SLO Decision Framework

| Service Tier | Availability SLO | Latency SLO | Error Budget/Day |
|--------------|-----------------|-------------|------------------|
| **Tier 1 (Revenue)** | 99.9% | p95 < 200ms | 8.6s |
| **Tier 2 (Core)** | 99.5% | p95 < 500ms | 43.8s |
| **Tier 3 (Internal)** | 99.0% | p95 < 1s | 87.6s |
| **Tier 4 (Experiments)** | 95.0% | p95 < 5s | 4.4min |

---

## Phase 3: Chaos Engineering

### Steady-State Hypothesis

```yaml
# chaos/steady-state.yaml
apiVersion: forgewright.io/v1
kind: SteadyStateHypothesis
metadata:
  name: service-api-steady-state
spec:
  title: "Service API remains available during controlled failures"
  
  probes:
    - name: api-availability
      type: http
      url: https://api.example.com/health
      expected:
        status: 200
        body:
          status: "healthy"
      tolerance:
        rate: 0.99  # 99% of probes must pass
        
    - name: latency-under-load
      type: metric
      query: |
        histogram_quantile(0.95,
          sum(rate(http_request_duration_seconds_bucket{service="service-api"}[5m])) by (le)
        )
      expected:
        max: 0.5  # 500ms
      tolerance:
        deviation: 0.2  # 20% deviation allowed
        
    - name: error-rate-stable
      type: metric
      query: |
        sum(rate(http_requests_total{status=~"5..",service="service-api"}[5m]))
        /
        sum(rate(http_requests_total{service="service-api"}[5m]))
      expected:
        max: 0.001  # 0.1%
      tolerance:
        max_deviation: 0.5  # Can spike to 0.15%
```

### Chaos Experiment Templates

```yaml
# chaos/experiments/service-failure.yaml
apiVersion: forgewright.io/v1
kind: ChaosExperiment
metadata:
  name: service-pod-failure
  owner: sre-team
spec:
  metadata:
    description: "Terminate service pods and verify graceful degradation"
    service: service-api
    
  steady_state:
    - name: service-availability
      ref: service-api-steady-state.availability
      
  method:
    - type: action
      name: terminate-pods
      provider:
        type: kubernetes
        spec:
          action: delete-pods
          label_selector:
            app: service-api
          count: 1  # Start with 1, increase to 50% of replicas
          duration: 60s
          
  probes:
    - name: service-continues
      type: http
      url: https://api.example.com/health
      expected:
        status: 200
      tolerance:
        rate: 0.95  # 95% success during experiment
        
    - name: latency-increases-slightly
      type: metric
      ref: service-api-steady-state.latency-under-load
      tolerance:
        deviation: 1.5  # 50% more latency acceptable
        
  rollbacks:
    - if: steady_state_not_maintained
      then: stop-experiment
    - if: error_rate > 0.05
      then: stop-experiment
```

```yaml
# chaos/experiments/database-failure.yaml
apiVersion: forgewright.io/v1
kind: ChaosExperiment
metadata:
  name: database-connection-failure
  owner: sre-team
spec:
  metadata:
    description: "Simulate database connection failure and verify fallback"
    
  steady_state:
    - ref: service-api-steady-state.availability
    
  method:
    - type: network
      name: block-database
      provider:
        type: iptables
        spec:
          mode: drop
          destination: database-service:5432
          duration: 30s
          
  probes:
    - name: graceful-degradation
      type: http
      url: https://api.example.com/api/read-endpoint
      expected:
        status: 200  # Should return cached/stale data
      tolerance:
        rate: 0.9
        
    - name: write-operations-fail
      type: http
      url: https://api.example.com/api/write-endpoint
      expected:
        status: 503
      tolerance:
        rate: 0.95
```

### Game Day Playbook

```markdown
## Game Day Playbook: [Service Name]

### Before Game Day
- [ ] Schedule game day with team (2-4 hours)
- [ ] Notify stakeholders of potential impact
- [ ] Disable auto-scaling to control experiment
- [ ] Ensure monitoring dashboards open
- [ ] Assign roles: Facilitator, Scribe, Tech Lead

### Roles
| Role | Responsibilities |
|------|-----------------|
| Facilitator | Runs experiments, calls aborts |
| Scribe | Documents findings, screenshots |
| Tech Lead | Makes decisions on findings |
| On-Call | Available for escalation |

### Experiment Sequence
1. **Baseline**: Record steady-state metrics (15 min)
2. **Pod failure**: Terminate 1 pod (10 min)
3. **Pod failure**: Terminate 50% pods (10 min)
4. **Database failure**: Block DB connections (10 min)
5. **Network partition**: Isolate service (10 min)
6. **Recovery**: Document recovery procedures (15 min)

### Abort Criteria
- Error rate exceeds 10%
- Latency p99 exceeds 5 seconds
- Any data corruption detected
- User-facing impact confirmed

### After Game Day
- [ ] Document findings
- [ ] Create follow-up tickets
- [ ] Update runbooks
- [ ] Schedule remediation
```

---

## Phase 4: Incident Management

### Severity Classification

| Severity | Definition | Response Time | Examples |
|----------|------------|--------------|----------|
| **SEV1** | Complete service outage | Immediate (< 5 min) | All users can't access, revenue impact |
| **SEV2** | Major feature broken | 15 minutes | Core functionality unavailable, degraded experience |
| **SEV3** | Minor feature broken | 1 hour | Non-critical feature affected, workaround exists |
| **SEV4** | Cosmetic/minor issue | Next business day | UI glitch, non-blocking bug |

### On-Call Rotation Template

```yaml
# incidents/on-call-rotation.yaml
schedule:
  type: handoff
  frequency: weekly
  
  rotations:
    - engineer: alice@example.com
      primary: true
      week: "2024-W01"
      
    - engineer: bob@example.com
      primary: false
      week: "2024-W01"
      
    - engineer: carol@example.com
      primary: false
      week: "2024-W01"
      
handoffs:
  time: Friday 17:00 UTC
  location: "#incidents" Slack channel
  duration: 15 minutes
  
responsibilities:
  primary:
    - Respond to pages within 5 minutes
    - Make escalation decisions
    - Coordinate incident response
    - Communicate status updates
    
  secondary:
    - Support primary responder
    - Take notes in war room
    - Assist with investigation
    - Page secondary users if needed
```

### Escalation Policy

```yaml
# incidents/escalation-policy.yaml
escalation:
  name: service-api-escalation
  
  levels:
    - level: 1
      name: On-Call Engineer
      timeout: 5 minutes
      triggers:
        - PagerDuty: sev1, sev2
        - Slack: sev3, sev4
        
    - level: 2
      name: Engineering Lead
      timeout: 15 minutes
      triggers:
        - On-Call: sev1 unresolved after 15 min
        - On-Call: sev2 with user impact
        
    - level: 3
      name: Engineering Manager
      timeout: 30 minutes
      triggers:
        - Level 2: sev1 unresolved after 30 min
        - Revenue impact confirmed
        
    - level: 4
      name: VP Engineering
      timeout: 60 minutes
      triggers:
        - Level 3: sev1 unresolved after 1 hour
        - Customer data at risk
```

### War Room Checklist

```markdown
## War Room Checklist

### First 5 Minutes
- [ ] Create incident Slack channel: #inc-YYYYMMDD-[brief-name]
- [ ] Assign Incident Commander (IC)
- [ ] Assign Scribe (notes + timeline)
- [ ] Post initial status: "Investigating [symptom]"

### Information Gathering
- [ ] When did the issue start? (check metrics)
- [ ] What changed recently? (check deployments, infra)
- [ ] How many users affected? (check error rates)
- [ ] Is it getting worse? (check trend)

### Diagnosis
- [ ] Check service health: `kubectl get pods -n production`
- [ ] Check recent deployments: `kubectl rollout history deployment/api`
- [ ] Check logs: `kubectl logs -f deployment/api --since=15m`
- [ ] Check metrics: Prometheus/Grafana dashboards
- [ ] Check external dependencies: Status pages

### Mitigation
- [ ] Can we roll back? (if deployment-related)
- [ ] Can we scale up? (if load-related)
- [ ] Can we redirect traffic? (if regional)
- [ ] Can we enable circuit breakers?

### Communication
- [ ] Update status page every 15 minutes
- [ ] Notify customer support with talking points
- [ ] Update Slack channel with findings
- [ ] Brief leadership if SEV1/2

### Resolution
- [ ] Confirm fix is working (metrics returning to normal)
- [ ] Post resolution message
- [ ] Schedule postmortem (within 48 hours)
```

### Runbook Template

```markdown
# Runbook: High Error Rate on [Service]

## Symptoms
- Error rate > 1% for 5 minutes
- Multiple 5xx responses in logs
- Alert fires: `alert:high_error_rate`

## Diagnosis Steps

### Step 1: Check Service Health
\`\`\`bash
kubectl get pods -n production -l app=[service] -o wide
kubectl describe pods -n production -l app=[service]
\`\`\`
Look for: Restarts, OOMKilled, CrashLoopBackOff

### Step 2: Check Recent Deployments
\`\`\`bash
kubectl rollout history deployment/[service]
kubectl get pods -n production -l app=[service] -o jsonpath='{.items[*].spec.containers[*].image}'
\`\`\`

### Step 3: Check Logs
\`\`\`bash
kubectl logs -f deployment/[service] -n production --since=15m | grep -i error
\`\`\`

### Step 4: Check Dependencies
- [ ] Database: `pg_isready -h database`
- [ ] Cache: `redis-cli -h redis ping`
- [ ] Queue: `kubectl get pods -n messaging`

## Mitigation Actions

### Option A: Rollback (if recent deployment)
\`\`\`bash
kubectl rollout undo deployment/[service] -n production
\`\`\`
Wait 2 minutes, check if error rate drops.

### Option B: Scale Up (if load-related)
\`\`\`bash
kubectl scale deployment/[service] --replicas=10 -n production
\`\`\`

### Option C: Restart Pods (if stuck)
\`\`\`bash
kubectl rollout restart deployment/[service] -n production
\`\`\`

## Resolution Criteria
- Error rate < 0.5% for 10 minutes
- No new 5xx errors in logs
- Health checks passing

## Follow-Up
- [ ] Schedule postmortem
- [ ] Identify root cause
- [ ] Create fix ticket
```

---

## Phase 5: Capacity Planning

### Load Model Template

```markdown
## Capacity Model: [Service Name]

### Current Baseline
| Metric | Current Value | Source |
|--------|---------------|--------|
| Requests/sec | X | Prometheus |
| p50 latency | Y ms | Prometheus |
| p95 latency | Z ms | Prometheus |
| Error rate | E% | Prometheus |
| CPU usage | C% | Prometheus |
| Memory usage | M% | Prometheus |

### Capacity Projections

#### 1x Load (Baseline)
- Current traffic level
- Expected behavior: All within SLOs

#### 10x Load (Growth/Event)
- Marketing campaign, product launch
- Required capacity: Scale to 10 replicas
- Bottleneck: CPU (projected 80% at 10x)

#### 100x Load (Extreme)
- Viral content, DDoS
- Required: Rate limiting + auto-scale
- Bottleneck: Database connections

### Scaling Triggers
| Metric | Warning | Critical | Action |
|--------|---------|----------|--------|
| CPU | 70% | 85% | Scale +1 replica |
| Memory | 75% | 90% | Scale +2 replicas |
| Latency p95 | 300ms | 500ms | Scale +1 replica |
| Error rate | 0.5% | 1% | Investigate |

### Cost Projection
| Load Level | Replicas | Cost/Month |
|-----------|----------|------------|
| 1x | 3 | $300 |
| 10x | 10 | $1,000 |
| 100x | 30 | $3,000 |

### Recommendations
1. Increase HPA max replicas from 10 to 20
2. Add database connection pooling (PgBouncer)
3. Implement request coalescing for cache misses
```

### HPA Configuration

```yaml
# capacity/hpa.yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: service-api-hpa
  namespace: production
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: service-api
    
  minReplicas: 3
  maxReplicas: 20
  
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 70  # Scale at 70% CPU
            
    - type: Resource
      resource:
        name: memory
        target:
          type: Utilization
          averageUtilization: 80  # Scale at 80% memory
            
    - type: Pods
      pods:
        metric:
          name: http_requests_per_second
        target:
          type: AverageValue
          averageValue: "1000"  # 1000 RPS per pod
          
  behavior:
    scaleDown:
      stabilizationWindowSeconds: 300  # 5 min cooldown
      policies:
        - type: Percent
          value: 10
          periodSeconds: 60
          
    scaleUp:
      stabilizationWindowSeconds: 0  # Immediate scale up
      policies:
        - type: Percent
          value: 100  # Can double replicas immediately
          periodSeconds: 15
```

---

## Common Mistakes

| Mistake | Why It Fails | What To Do Instead |
|---------|-------------|---------------------|
| Setting SLOs at 99.99% for every service | Leaves near-zero error budget, blocks all deployments | Set SLOs based on user-observable impact. Start with 99.5% and tighten. |
| Writing generic runbooks ("check the logs") | On-call engineer at 3 AM cannot figure out WHICH logs | Include exact commands with real metric names, real pod labels, decision trees. |
| Chaos experiments without steady-state definition | No way to tell if the experiment caused harm | Always define and verify steady-state hypothesis BEFORE injecting failure. |
| Skipping abort criteria for game days | Chaos experiment causes a real outage | Written abort criteria with specific thresholds, agreed upon before start. |
| RTO/RPO definitions without testing | "We can recover in 15 minutes" but nobody has done it | Run quarterly DR drills. Time the actual recovery. Update estimates with real data. |
| Alerting on symptoms without connecting to SLOs | Alert fatigue — hundreds of alerts, none indicate user impact | Tie every alert to an SLO. If it does not map to an SLO, it is a log line, not a page. |
| Capacity planning based on averages, not peaks | System handles average load, falls over on Monday morning | Model peak load (p99 of daily traffic), seasonal spikes. Size for peaks. |
| Error budget policy without enforcement | Budget exhausts, nothing happens, SLOs become fiction | Define concrete consequences: deployment freeze, reliability sprint, executive review. |
| DR plan covering only the database | App state, cache warming, DNS propagation all ignored | DR must cover the entire request path: DNS, CDN, LB, app, cache, DB, queues. |

---

## Output Structure

### Project Root (Deliverables)
```
docs/runbooks/<service-name>/
    high-error-rate.md, high-latency.md, out-of-memory.md, dependency-down.md
```

### Workspace (Assessment & Analysis)
```
.forgewright/sre/
    production-readiness/
        checklist.md, findings.md, remediation.md
    slo/
        sli-definitions.yaml, slo-dashboard.json, error-budget-policy.md, burn-rate-alerts.yaml
    chaos/
        scenarios/*.yaml, game-day-playbook.md, steady-state-hypothesis.md
    capacity/
        load-model.md, scaling-configs.yaml, cost-projection.md, bottleneck-analysis.md
    incidents/
        on-call-rotation.yaml, escalation-policy.yaml, severity-classification.md
    disaster-recovery/
        rto-rpo-definitions.md, failover-playbook.md, backup-verification.md
```

---

## Handoff

| Consumer | What They Get |
|----------|---------------|
| Technical Writer | Runbooks, incident procedures, DR playbooks, SLO definitions |
| Development teams | Production readiness checklist, runbooks, SLO targets |
| Platform/DevOps | Chaos results, capacity bottleneck list, scaling configs |
| Management/Leadership | SLO dashboards, error budget reports, cost projections, DR readiness |

---

## Verification Checklist

- [ ] Every service has a production readiness review
- [ ] Every user-facing endpoint has at least one SLO (availability + latency)
- [ ] Error budget policy documented with enforcement actions
- [ ] Burn-rate alerts configured with multi-window approach
- [ ] At least 4 chaos scenarios defined with steady-state hypothesis
- [ ] Game day playbook has explicit abort criteria
- [ ] Load model covers 1x, 10x, and 100x projections
- [ ] Bottleneck analysis identifies first 3 components to saturate
- [ ] On-call rotation covers 24/7 with escalation policy
- [ ] Severity classification has concrete examples for each level
- [ ] Communication templates are pre-written
- [ ] War room procedures define explicit roles (IC, comms, tech lead, scribe)
- [ ] RTO/RPO defined for every stateful component
- [ ] Failover playbook reviewed against actual infrastructure topology
- [ ] Every alert has a corresponding runbook with exact commands
- [ ] Runbooks include decision trees, not just prose
- [ ] All runbook commands use real metric names and pod labels from this system
