import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { relative, resolve, sep } from 'node:path';

export type ContainmentMode = 'local' | 'production';
export type ToolEffect = 'state' | 'bounded-skill-read' | 'filesystem' | 'process' | 'network';
export interface RuntimeTrustContext {
  mode: ContainmentMode;
  workspace: string;
  callerId: string | null;
  profile: string;
  profileDigest: string;
  policyDigest: string;
}
export interface ContainmentDecision {
  allowed: boolean;
  code: string;
  profileDigest: string;
}

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const EFFECTS: Record<string, ToolEffect> = {
  fw_start_pipeline: 'state',
  fw_get_current_phase: 'state',
  fw_advance_to_next_phase: 'state',
  fw_request_gate_approval: 'state',
  fw_approve_gate: 'state',
  fw_update_subtask: 'state',
  fw_update_self_healing: 'state',
  fw_fail_pipeline: 'state',
  fw_log_token_usage: 'state',
  fw_update_status_and_log_usage: 'state',
  fw_check_pipeline_compliance: 'state',
  fw_load_skill_overlay: 'bounded-skill-read',
};
const digest = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');

function policySnapshot(workspace: string) {
  const path = resolve(workspace, '.forgewright/execution-policy.yaml');
  const info = lstatSync(path);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error('EXECUTION_POLICY_INVALID');
  const resolved = realpathSync(path);
  const relation = relative(workspace, resolved);
  if (
    relation === '..' ||
    relation.startsWith(`..${sep}`) ||
    resolve(workspace, relation) !== resolved
  )
    throw new Error('EXECUTION_POLICY_INVALID');
  if (typeof process.getuid === 'function' && info.uid !== process.getuid())
    throw new Error('EXECUTION_POLICY_INVALID');
  if ((info.mode & 0o022) !== 0) throw new Error('EXECUTION_POLICY_INVALID');
  return { path, identity: `${info.dev}:${info.ino}`, digest: digest(readFileSync(path)) };
}

export class ExecutionContainment {
  private readonly policy: ReturnType<typeof policySnapshot>;
  constructor(readonly trust: RuntimeTrustContext) {
    this.policy = policySnapshot(trust.workspace);
  }
  admit(toolName: string, arguments_: Record<string, unknown>): ContainmentDecision {
    try {
      const current = policySnapshot(this.trust.workspace);
      if (current.identity !== this.policy.identity || current.digest !== this.policy.digest)
        return this.deny('CONTAINMENT_POLICY_CHANGED');
    } catch {
      return this.deny('CONTAINMENT_POLICY_INVALID');
    }
    const effect = EFFECTS[toolName];
    if (!effect) return this.deny('CONTAINMENT_UNKNOWN_TOOL');
    if (effect === 'process' || effect === 'network') return this.deny('CONTAINMENT_EFFECT_DENIED');
    if (effect === 'filesystem') return this.deny('CONTAINMENT_EFFECT_DENIED');
    if (
      effect === 'bounded-skill-read' &&
      (typeof arguments_.name !== 'string' || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(arguments_.name))
    )
      return this.deny('CONTAINMENT_INVALID_ARGUMENTS');
    return { allowed: true, code: 'CONTAINMENT_ALLOWED', profileDigest: this.trust.profileDigest };
  }
  private deny(code: string): ContainmentDecision {
    return { allowed: false, code, profileDigest: this.trust.profileDigest };
  }
}

export function loadRuntimeTrustContext(environment = process.env): RuntimeTrustContext {
  const rawMode = environment.FORGEWRIGHT_RUNTIME_MODE;
  if (rawMode !== undefined && rawMode !== 'local' && rawMode !== 'production') {
    throw new Error('RUNTIME_TRUST_CONTEXT_INVALID');
  }
  const mode: ContainmentMode = rawMode === 'production' ? 'production' : 'local';
  const workspace = realpathSync(resolve(environment.FORGEWRIGHT_WORKSPACE ?? process.cwd()));
  if (workspace === '/' || workspace === homedir()) throw new Error('RUNTIME_WORKSPACE_BROAD_ROOT');
  const callerId = environment.FORGEWRIGHT_CALLER_ID ?? null;
  const profile = environment.FORGEWRIGHT_CONTAINMENT_PROFILE ?? 'application';
  if (mode === 'production' && (!callerId || !SAFE_ID.test(callerId) || profile !== 'application'))
    throw new Error('RUNTIME_TRUST_CONTEXT_INVALID');
  const policy = policySnapshot(workspace);
  return {
    mode,
    workspace,
    callerId,
    profile,
    profileDigest: digest(`${mode}:${profile}`),
    policyDigest: policy.digest,
  };
}
