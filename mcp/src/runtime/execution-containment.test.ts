import { mkdtempSync, mkdirSync, writeFileSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ExecutionContainment, loadRuntimeTrustContext } from './execution-containment.js';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'containment-'));
  mkdirSync(join(root, '.forgewright'));
  writeFileSync(join(root, '.forgewright', 'execution-policy.yaml'), 'mode: strict\n');
  return root;
}
describe('ExecutionContainment', () => {
  it('allows registered state tools and denies unknown and filesystem effects', () => {
    const root = fixture();
    const containment = new ExecutionContainment(
      loadRuntimeTrustContext({ FORGEWRIGHT_WORKSPACE: root }),
    );
    expect(containment.admit('fw_get_current_phase', {}).allowed).toBe(true);
    for (const toolName of [
      'fw_get_product_intent',
      'fw_initialize_product_intent',
      'fw_apply_product_delta',
      'fw_get_product_goal_projection',
      'fw_evaluate_product_clarification',
    ]) {
      expect(containment.admit(toolName, {}).allowed).toBe(true);
    }
    expect(containment.admit('fw_get_product_intent_typo', {}).code).toBe(
      'CONTAINMENT_UNKNOWN_TOOL',
    );
    expect(containment.admit('unknown', {}).code).toBe('CONTAINMENT_UNKNOWN_TOOL');
    expect(containment.admit('Bash', {}).code).toBe('CONTAINMENT_UNKNOWN_TOOL');
    expect(containment.admit('WebFetch', {}).code).toBe('CONTAINMENT_UNKNOWN_TOOL');
    expect(containment.admit('fw_load_skill_overlay', { name: 'software-engineer' }).allowed).toBe(
      true,
    );
    expect(containment.admit('fw_load_skill_overlay', { name: '../escape' }).code).toBe(
      'CONTAINMENT_INVALID_ARGUMENTS',
    );
  });
  it('fails closed after policy replacement and validates production identity/profile', () => {
    const root = fixture();
    const containment = new ExecutionContainment(
      loadRuntimeTrustContext({ FORGEWRIGHT_WORKSPACE: root }),
    );
    writeFileSync(join(root, '.forgewright', 'replacement'), 'mode: audit\n');
    renameSync(
      join(root, '.forgewright', 'replacement'),
      join(root, '.forgewright', 'execution-policy.yaml'),
    );
    expect(containment.admit('fw_get_current_phase', {}).code).toBe('CONTAINMENT_POLICY_CHANGED');
    expect(() =>
      loadRuntimeTrustContext({
        FORGEWRIGHT_WORKSPACE: root,
        FORGEWRIGHT_RUNTIME_MODE: 'production',
      }),
    ).toThrow('RUNTIME_TRUST_CONTEXT_INVALID');
    expect(() =>
      loadRuntimeTrustContext({
        FORGEWRIGHT_WORKSPACE: root,
        FORGEWRIGHT_RUNTIME_MODE: 'staging',
      }),
    ).toThrow('RUNTIME_TRUST_CONTEXT_INVALID');
  });
});
