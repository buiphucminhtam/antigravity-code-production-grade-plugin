import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { ReferenceWebDriver } from "./driver.mjs";
import {
  ENVIRONMENT_ACI_SCHEMA_VERSION,
  createEnvironmentAciDescriptor,
  createEnvironmentAction,
} from "../../mcp/build/product-factory/environment-aci.js";
import { WebEnvironmentAciAdapter } from "../../mcp/build/product-factory/adapters/web-environment-aci.js";
import { createProductIntent } from "../../mcp/build/product-factory/product-intent.js";
import {
  createProductOutcomeContract,
  hashProductOutcomePayload,
} from "../../mcp/build/product-factory/product-outcome-contract.js";
import {
  createCriticalJourneyRunner,
  parseProductOutcomeResultReceipt,
} from "../../mcp/build/product-factory/product-outcome-runner.js";
import { judgeProductOutcome } from "../../mcp/build/product-factory/product-outcome-judge.js";

const hash = (value) => createHash("sha256").update(value).digest("hex");
const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const reportBase = join(ROOT, ".forgewright/reports/web-reference");
mkdirSync(reportBase, { recursive: true });
const outputRoot = mkdtempSync(join(reportBase, "run-"));
const label = "Ship the Web reference";
const operations = Object.freeze({
  observe: true,
  act: true,
  reset: true,
  snapshot: true,
  restore: true,
  runScenario: true,
  collectEvidence: true,
});
const actions = [
  {
    actionId: "enter-task",
    kind: "fill",
    payload: { target: { role: "textbox", name: "Task name" }, value: label },
  },
  {
    actionId: "add-task",
    kind: "click",
    payload: { target: { role: "button", name: "Add task" } },
  },
  {
    actionId: "complete-task",
    kind: "click",
    payload: { target: { role: "checkbox", name: `Complete ${label}` } },
  },
];
const assertion = (id, actionId, path, value) => ({
  id,
  category: "requirement",
  subject: { kind: "observation", actionId, path: ["accessibility", ...path] },
  expected: { kind: typeof value, operator: "equals", value },
});
const assertions = [
  assertion("one-task-created", "add-task", ["count"], 1),
  assertion("created-task-is-open", "add-task", ["completed"], 0),
  assertion("task-completed", "complete-task", ["completed"], 1),
  assertion("nothing-left", "complete-task", ["summary"], "0 tasks remaining"),
  assertion(
    "no-horizontal-overflow",
    "complete-task",
    ["horizontalOverflow"],
    false,
  ),
];
// Freeze the semantic oracle before baseline/mutation execution. Only the environment binding changes.
const oracleSha256 = hashProductOutcomePayload({ actions, assertions });
const startedAt = new Date().toISOString();
const intent = createProductIntent({
  intentId: "web-reference-intent",
  createdAt: startedAt,
  problem: {
    id: "track-task",
    statement:
      "A user must create and complete a task with observable feedback.",
    evidenceRefs: [],
  },
  targetActors: [
    {
      id: "owner",
      name: "Task owner",
      description: "A user managing a short focus list.",
      evidenceRefs: [],
    },
  ],
  jobsToBeDone: [
    {
      id: "finish-task",
      actorIds: ["owner"],
      statement: "Record and complete one task.",
      desiredOutcomeIds: ["task-done"],
    },
  ],
  desiredOutcomes: [
    {
      id: "task-done",
      statement: "The task is checked and no task remains.",
      acceptanceRefs: ["accept-task-done"],
    },
  ],
  constraints: [],
  nonGoals: [],
  preferences: [],
  uncertainty: [],
  decisions: [],
  scenarios: [
    {
      id: "web-task-journey",
      name: "Create and complete a task",
      platform: "web",
      actorIds: ["owner"],
      jobIds: ["finish-task"],
      outcomeIds: ["task-done"],
      preconditions: ["The list is empty."],
      steps: ["Enter the task name.", "Add the task.", "Complete the task."],
      expectedOutcomes: [
        "The task is checked and the remaining count is zero.",
      ],
    },
  ],
  acceptanceRefs: [
    {
      id: "accept-task-done",
      statement:
        "Actual browser state proves the task exists and is completed.",
      evidenceRef: null,
    },
  ],
  provenance: [
    {
      id: "reference-scope",
      source: "bounded-inference",
      reference:
        "Minimal local Web reference selected for the approved Product Factory integration roadmap; not a customer product requirement.",
      observedAt: startedAt,
      current: true,
      approved: false,
    },
  ],
  goalGraph: {
    nodes: [
      {
        id: "goal-outcome",
        type: "outcome",
        statement: "Task completes.",
        intentRef: "task-done",
      },
      {
        id: "goal-capability",
        type: "capability",
        statement: "Focus list interactions.",
        intentRef: null,
      },
      {
        id: "goal-scenario",
        type: "scenario",
        statement: "Create and complete a task.",
        intentRef: "web-task-journey",
      },
    ],
    edges: [
      { id: "outcome-capability", from: "goal-outcome", to: "goal-capability" },
      {
        id: "capability-scenario",
        from: "goal-capability",
        to: "goal-scenario",
      },
    ],
  },
});

class CapturingAdapter extends WebEnvironmentAciAdapter {
  async runScenario(scenario) {
    this.executedScenario = scenario;
    this.scenarioReceipt = await super.runScenario(scenario);
    return this.scenarioReceipt;
  }
}

async function runJourney(name, viewport, mutation = false) {
  const root = join(outputRoot, name);
  mkdirSync(root);
  const driver = new ReferenceWebDriver({
    artifactRoot: root,
    viewport,
    mutation,
  });
  const evidence = {
    name,
    mutation,
    viewport,
    evidenceAuthority: "test-only",
    productionEligible: false,
  };
  try {
    await driver.launch();
    const id = randomUUID();
    const descriptor = createEnvironmentAciDescriptor({
      adapterId: `reference-${id}`,
      environmentId: `focus-list-${id}`,
      sessionId: `browser-${id}`,
      kind: "web",
      operationTimeoutMs: 10_000,
      operations,
      actionKinds: ["navigate", "click", "fill", "press", "scroll"],
      environment: {
        browser: "chrome",
        browserVersion: driver.browserVersion,
        sourceSha256: driver.sourceSha256,
        viewport,
        transport: "offline-set-content",
        profile: "owned-ephemeral",
      },
    });
    const capability = {
      schemaVersion: ENVIRONMENT_ACI_SCHEMA_VERSION,
      enabled: true,
      environmentFingerprint: descriptor.environmentFingerprint,
      capabilityFingerprint: descriptor.capabilityFingerprint,
      operationTimeoutMs: descriptor.operationTimeoutMs,
      operations,
      reason: null,
      limitations: ["offline-reference-only", "remote-navigation-disabled"],
    };
    const adapter = new CapturingAdapter({
      descriptor,
      driver,
      hostCapability: capability,
      trustedArtifactDirectory: root,
    });
    const contract = createProductOutcomeContract(
      {
        contractId: "web-reference-outcome",
        intent: {
          intentId: intent.intentId,
          version: intent.version,
          hash: intent.hash,
        },
        desiredOutcomeIds: ["task-done"],
        scenarioIds: ["web-task-journey"],
        environment: {
          adapterId: descriptor.adapterId,
          environmentId: descriptor.environmentId,
          sessionId: descriptor.sessionId,
          kind: descriptor.kind,
          environmentFingerprint: descriptor.environmentFingerprint,
          capabilityFingerprint: descriptor.capabilityFingerprint,
        },
        evidenceAuthority: "test-only",
        syntheticUser: false,
        journeys: [
          {
            scenarioId: "web-task-journey",
            desiredOutcomeIds: ["task-done"],
            applicable: true,
            runnable: true,
            stateReason: null,
            actions,
            assertions,
            requiredEvidence: [
              {
                id: "completion-artifacts",
                actionId: "complete-task",
                mediaTypes: ["image/png", "application/json"],
                minimumArtifacts: 1,
              },
            ],
            negativePaths: [
              "web-console-error",
              "web-reference-target-invalid",
            ],
            limitations: [
              "local-browser-reference-not-production",
              "offline-reference-only",
              "remote-navigation-disabled",
            ],
          },
        ],
      },
      intent,
      descriptor,
    );
    const requestedAt = new Date().toISOString();
    const result = await createCriticalJourneyRunner(
      adapter,
      descriptor,
      capability,
    ).run({
      contract,
      intent,
      scenarioId: "web-task-journey",
      executionId: `journey-${id}`,
      requestedAt,
      deadlineAt: new Date(Date.now() + 60_000).toISOString(),
    });
    Object.assign(evidence, {
      sourceSha256: driver.sourceSha256,
      baseSourceSha256: driver.baseSourceSha256,
      browserVersion: driver.browserVersion,
      intentHash: intent.hash,
      oracleSha256,
      descriptor,
      contract,
      result,
      scenario: adapter.executedScenario,
      scenarioReceipt: adapter.scenarioReceipt,
    });
    assert.ok(
      adapter.scenarioReceipt,
      "Actual ACI execution must emit a receipt.",
    );
    const verification = {
      contract,
      intent,
      expectedScenario: adapter.executedScenario,
      scenarioReceipt: adapter.scenarioReceipt,
    };
    assert.deepEqual(
      await parseProductOutcomeResultReceipt(result, verification),
      result,
    );
    const judgment = await judgeProductOutcome({
      runnerResult: result,
      runnerVerification: verification,
      specialistReceipts: [],
      judgedAt: new Date().toISOString(),
    });
    evidence.judgment = judgment;
    assert.equal(result.executed, true);
    assert.equal(result.evidenceAuthority, "test-only");
    assert.equal(
      result.aciStatus,
      "PASS",
      "Actual browser actions, artifact validation and cleanup must complete.",
    );
    assert.equal(
      result.status,
      mutation ? "FAIL" : "PASS",
      JSON.stringify(result),
    );
    assert.equal(
      judgment.status,
      mutation ? "FAIL" : "UNVERIFIED",
      "The product judge must not upgrade local-only evidence.",
    );
    assert.equal(result.intentHash, intent.hash);
    assert.equal(
      oracleSha256,
      hashProductOutcomePayload({ actions, assertions }),
    );
    if (mutation) {
      assert.equal(result.reason, "assertion-failed");
      assert.ok(
        result.assertionResults.some(
          (item) =>
            item.assertionId === "task-completed" && item.status === "FAIL",
        ),
      );
    } else {
      assert.ok(
        result.assertionResults.every((item) => item.status === "PASS"),
      );
      const created = adapter.scenarioReceipt.observations.find(
        (item) => item.afterActionId === "add-task",
      );
      assert.equal(created.state.accessibility.items[0].text, label);
      assert.equal(
        adapter.scenarioReceipt.cleanupObservation.state.accessibility.count,
        0,
      );
      // Round-trip the real reference through its UI rather than injecting completed state.
      await driver.fill(
        { role: "textbox", name: "Task name" },
        "Snapshot task",
      );
      await driver.press("Enter");
      await driver.click({ role: "checkbox", name: "Complete Snapshot task" });
      const request = {
        schemaVersion: ENVIRONMENT_ACI_SCHEMA_VERSION,
        adapterId: descriptor.adapterId,
        environmentId: descriptor.environmentId,
        sessionId: descriptor.sessionId,
        scenarioId: "web-task-journey",
        executionId: `snapshot-${id}`,
        sequence: 100,
        requestedAt: new Date().toISOString(),
      };
      const saved = await adapter.snapshot(request);
      await driver.reset();
      const restored = await adapter.restore(saved);
      assert.equal(restored.state.accessibility.count, 1);
      assert.equal(restored.state.accessibility.completed, 1);
      await assert.rejects(adapter.restore(saved), /web-snapshot-replay/);
      await assert.rejects(
        driver.navigate("/"),
        /web-navigation-disabled-local-reference/,
      );
      evidence.snapshot = {
        saved,
        restored,
        replayRejected: true,
        navigationDenied: true,
      };
      // Check empty and duplicate submissions through the actual product controls.
      await driver.reset();
      await driver.click({ role: "button", name: "Add task" });
      assert.equal((await driver.observe()).accessibility.count, 0);
      await driver.fill({ role: "textbox", name: "Task name" }, "Unique task");
      await driver.press("Enter");
      await driver.fill({ role: "textbox", name: "Task name" }, "Unique task");
      await driver.press("Enter");
      assert.equal((await driver.observe()).accessibility.count, 1);
      evidence.inputChecks = { emptyRejected: true, duplicateRejected: true };
    }
    return evidence;
  } finally {
    evidence.lease = await driver.close();
    writeFileSync(
      join(root, "evidence.json"),
      JSON.stringify(evidence, null, 2) + "\n",
      { mode: 0o600 },
    );
  }
}

test(
  "real Chromium: locked intent survives product mutation and restoration on desktop and mobile",
  { timeout: 120_000 },
  async () => {
    const source = readFileSync(new URL("./index.html", import.meta.url));
    const results = [];
    const summary = {
      schemaVersion: "forgewright-web-reference-run/v1",
      status: "FAIL",
      scope: "real-browser-local-reference",
      productionEligible: false,
      independentReview: "UNVERIFIED",
      startedAt,
      oracleSha256,
      intentHash: intent.hash,
      results,
    };
    try {
      results.push(
        await runJourney("desktop-baseline", { width: 1280, height: 800 }),
      );
      results.push(
        await runJourney(
          "desktop-mutation",
          { width: 1280, height: 800 },
          true,
        ),
      );
      results.push(
        await runJourney("desktop-restored", { width: 1280, height: 800 }),
      );
      results.push(
        await runJourney("mobile-restored", { width: 390, height: 844 }),
      );
      assert.equal(results[0].sourceSha256, results[2].sourceSha256);
      assert.notEqual(results[0].sourceSha256, results[1].sourceSha256);
      assert.deepEqual(
        readFileSync(new URL("./index.html", import.meta.url)),
        source,
      );
      assert.ok(
        results.every(
          (item) =>
            item.intentHash === intent.hash &&
            item.oracleSha256 === oracleSha256,
        ),
      );
      assert.ok(
        results.every(
          (item) =>
            item.lease.processExited &&
            item.lease.pagesOpened === item.lease.pagesClosed,
        ),
      );
      summary.status = "PASS";
      summary.sourceUnchanged = true;
    } finally {
      summary.completedAt = new Date().toISOString();
      summary.results = results.map(
        ({
          name,
          sourceSha256,
          browserVersion,
          result,
          judgment,
          lease,
          snapshot,
          inputChecks,
        }) => ({
          name,
          sourceSha256,
          browserVersion,
          runtimeStatus: result.status,
          aciStatus: result.aciStatus,
          judgmentStatus: judgment.status,
          assertionResults: result.assertionResults,
          lease,
          snapshotRoundtrip: Boolean(snapshot),
          inputChecks,
        }),
      );
      writeFileSync(
        join(outputRoot, "summary.json"),
        JSON.stringify(summary, null, 2) + "\n",
        { mode: 0o600 },
      );
      console.log(`Reference evidence: ${outputRoot}`);
    }
  },
);
