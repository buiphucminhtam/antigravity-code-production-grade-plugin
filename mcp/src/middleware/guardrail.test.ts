import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProcessPolicyEvaluator } from './guardrail.js';

function policyScript(body: string): { root: string; script: string } {
  const root = mkdtempSync(join(tmpdir(), 'forgewright-policy-evaluator-'));
  const policyDir = join(root, '.forgewright');
  mkdirSync(policyDir, { recursive: true });
  writeFileSync(
    join(policyDir, 'execution-policy.yaml'),
    'mode: strict\nrequire_verify: true\nmax_escalations: 3\nrefresh_interval_ticks: 10\ndeny_patterns:\n  - "blocked"\n',
  );
  const script = join(root, 'policy-check.sh');
  writeFileSync(script, `#!/usr/bin/env bash\n${body}\n`, { mode: 0o700 });
  return { root, script };
}

describe('ProcessPolicyEvaluator', () => {
  it('does not leak unrelated parent secrets into the policy subprocess', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'forgewright-policy-env-'));
    const policyDir = join(workspace, '.forgewright');
    mkdirSync(policyDir, { recursive: true });
    writeFileSync(
      join(policyDir, 'execution-policy.yaml'),
      'mode: strict\nrequire_verify: true\nmax_escalations: 3\nrefresh_interval_ticks: 10\ndeny_patterns:\n  - "blocked"\n',
    );
    const script = join(workspace, 'check.sh');
    writeFileSync(
      script,
      '#!/usr/bin/env bash\n[[ -z "${FORGEWRIGHT_TEST_SECRET:-}" ]] || exit 9\nexit 0\n',
      { mode: 0o700 },
    );
    vi.stubEnv('FORGEWRIGHT_TEST_SECRET', 'must-not-leak');
    const evaluator = new ProcessPolicyEvaluator({ cwd: workspace, scriptPath: script });

    await expect(evaluator.evaluate('tool', {})).resolves.toMatchObject({ action: 'allow' });
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.each([
    [0, 'allow'],
    [1, 'block'],
    [2, 'warn'],
    [3, 'config-error'],
  ] as const)('maps policy exit %s to %s', async (exitCode, action) => {
    const { root, script } = policyScript(`echo policy-result >&2\nexit ${exitCode}`);
    const evaluator = new ProcessPolicyEvaluator({ scriptPath: script, cwd: root });

    await expect(evaluator.evaluate('Bash', { cmd: 'echo ok' })).resolves.toMatchObject({ action });
  });

  it('distinguishes a fail-closed policy configuration error from a normal denial', async () => {
    const { root, script } = policyScript(
      'echo "Execution policy is missing, unreadable, empty, or malformed" >&2\nexit 1',
    );
    const evaluator = new ProcessPolicyEvaluator({ scriptPath: script, cwd: root });

    await expect(evaluator.evaluate('Bash', { cmd: 'echo ok' })).resolves.toMatchObject({
      action: 'config-error',
    });
  });

  it('passes tool data as literal argv without shell interpolation', async () => {
    const { root, script } = policyScript('exit 0');
    const marker = join(root, 'injected');
    const evaluator = new ProcessPolicyEvaluator({ scriptPath: script, cwd: root });

    await evaluator.evaluate('Bash', { cmd: `touch ${marker}; $(touch ${marker})` });

    expect(existsSync(marker)).toBe(false);
  });

  it('passes shell command fields in the form expected by the policy parser', async () => {
    const { root, script } = policyScript('[[ "$3" = "git -C . reset --hard" ]] || exit 3\nexit 1');
    const evaluator = new ProcessPolicyEvaluator({ scriptPath: script, cwd: root });

    await expect(
      evaluator.evaluate('Bash', { cmd: 'git -C . reset --hard' }),
    ).resolves.toMatchObject({ action: 'block' });
  });

  it('resolves workspace policy and Forgewright script from launcher environment', async () => {
    const root = mkdtempSync(join(tmpdir(), 'forgewright-launcher-layout-'));
    const workspace = join(root, 'workspace');
    const forgewrightDir = join(root, 'forgewright');
    const script = join(forgewrightDir, 'scripts/lite/policy-check.sh');
    mkdirSync(join(workspace, '.forgewright'), { recursive: true });
    mkdirSync(join(forgewrightDir, 'scripts/lite'), { recursive: true });
    writeFileSync(join(workspace, '.forgewright/execution-policy.yaml'), 'mode: strict\n');
    writeFileSync(
      script,
      [
        '#!/usr/bin/env bash',
        '[[ "$(pwd -P)" = "$(cd "$FORGEWRIGHT_WORKSPACE" && pwd -P)" ]] || exit 3',
        '[[ "$FORGEWRIGHT_POLICY_FILE" = "$FORGEWRIGHT_WORKSPACE/.forgewright/execution-policy.yaml" ]] || exit 3',
        'exit 0',
      ].join('\n'),
      { mode: 0o700 },
    );
    vi.stubEnv('FORGEWRIGHT_WORKSPACE', workspace);
    vi.stubEnv('FORGEWRIGHT_DIR', forgewrightDir);
    vi.stubEnv('FORGEWRIGHT_POLICY_FILE', '');

    const evaluator = new ProcessPolicyEvaluator();

    const evaluation = await evaluator.evaluate('Bash', { cmd: 'echo safe' });
    expect(evaluation, evaluation.reason).toMatchObject({ action: 'allow' });
  });

  it('discovers the nearest workspace ancestor when launched from its mcp directory', async () => {
    const root = mkdtempSync(join(tmpdir(), 'forgewright-cwd-layout-'));
    const mcpDirectory = join(root, 'mcp');
    const script = join(root, 'scripts/lite/policy-check.sh');
    mkdirSync(join(root, '.forgewright'), { recursive: true });
    mkdirSync(join(root, 'scripts/lite'), { recursive: true });
    mkdirSync(mcpDirectory);
    writeFileSync(join(root, '.forgewright/execution-policy.yaml'), 'mode: strict\n');
    writeFileSync(
      script,
      [
        '#!/usr/bin/env bash',
        '[[ "$(cd "$(dirname "$FORGEWRIGHT_POLICY_FILE")/.." && pwd -P)" = "$(pwd -P)" ]] || exit 3',
        'exit 0',
      ].join('\n'),
      { mode: 0o700 },
    );
    vi.stubEnv('FORGEWRIGHT_WORKSPACE', '');
    vi.stubEnv('FORGEWRIGHT_DIR', '');
    vi.stubEnv('FORGEWRIGHT_POLICY_FILE', '');

    const evaluator = new ProcessPolicyEvaluator({ cwd: mcpDirectory });

    await expect(evaluator.evaluate('Bash', { cmd: 'echo safe' })).resolves.toMatchObject({
      action: 'allow',
    });
  });

  it('uses the canonical policy script when generated MCP config has no FORGEWRIGHT_DIR', async () => {
    const home = mkdtempSync(join(tmpdir(), 'forgewright-canonical-home-'));
    const workspace = join(home, 'workspace');
    const script = join(home, '.forgewright/scripts/lite/policy-check.sh');
    mkdirSync(join(workspace, '.forgewright'), { recursive: true });
    mkdirSync(join(home, '.forgewright/scripts/lite'), { recursive: true });
    writeFileSync(join(workspace, '.forgewright/execution-policy.yaml'), 'mode: strict\n');
    writeFileSync(script, '#!/usr/bin/env bash\n[[ "$1" = "check" ]] || exit 3\nexit 0\n', {
      mode: 0o700,
    });
    vi.stubEnv('HOME', home);
    vi.stubEnv('FORGEWRIGHT_WORKSPACE', workspace);
    vi.stubEnv('FORGEWRIGHT_DIR', '');
    vi.stubEnv('FORGEWRIGHT_POLICY_FILE', '');

    const evaluator = new ProcessPolicyEvaluator();

    await expect(evaluator.evaluate('Bash', { cmd: 'echo safe' })).resolves.toMatchObject({
      action: 'allow',
    });
  });

  it('returns config-error when the policy process times out', async () => {
    const { root, script } = policyScript('sleep 2');
    const evaluator = new ProcessPolicyEvaluator({ scriptPath: script, cwd: root, timeoutMs: 20 });

    await expect(evaluator.evaluate('Bash', { cmd: 'echo ok' })).resolves.toMatchObject({
      action: 'config-error',
      reason: expect.stringContaining('timed out'),
    });
  });

  it('returns config-error when policy output exceeds the configured bound', async () => {
    const { root, script } = policyScript("printf '%0200d' 0");
    const evaluator = new ProcessPolicyEvaluator({
      scriptPath: script,
      cwd: root,
      maxOutputBytes: 32,
    });

    await expect(evaluator.evaluate('Bash', { cmd: 'echo ok' })).resolves.toMatchObject({
      action: 'config-error',
      reason: expect.stringContaining('output limit'),
    });
  });
  it('fails closed after a script or policy content replacement', async () => {
    const { root, script } = policyScript('exit 0');
    const evaluator = new ProcessPolicyEvaluator({ scriptPath: script, cwd: root });
    writeFileSync(script, '#!/usr/bin/env bash\necho replaced >&2\nexit 0\n', { mode: 0o700 });
    await expect(evaluator.evaluate('Bash', {})).resolves.toMatchObject({ action: 'config-error' });
  });
});
