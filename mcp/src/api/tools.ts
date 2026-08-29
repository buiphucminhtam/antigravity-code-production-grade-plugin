import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { randomUUID } from 'node:crypto';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { ToolExecutionGateway } from '../runtime/tool-execution-gateway.js';
import { loadSkillOverlay, SkillOverlayError } from '../parsers/skill-parser.js';
import {
  startPipeline,
  getState,
  advancePhase,
  requestGateApproval,
  approveGate,
  updateSubTask,
  updateSelfHealing,
  failPipeline,
  logTokenUsage,
  checkPipelineCompliance,
  PIPELINE_PHASES,
  QualityGateState,
  SelfHealingState,
} from '../state/pipeline-manager.js';

export function registerTools(
  server: Server,
  toolGateway = new ToolExecutionGateway(),
  context: { sessionId?: string; deferredSkillNames?: readonly string[] } = {},
) {
  // stdio serves one MCP client per server process. Keep its cache namespace
  // stable across calls while keeping separate server instances isolated.
  const sessionId =
    context.sessionId ?? `${process.env.FORGEWRIGHT_SESSION_ID ?? 'mcp'}:${randomUUID()}`;
  let turnNumber = 0;
  const deferredSkillNames = new Set(context.deferredSkillNames ?? []);
  const loadedSkills = new Set<string>();
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: [
        ...(deferredSkillNames.size > 0
          ? [
              {
                name: 'fw_load_skill_overlay',
                description: 'Load one bounded Forgewright skill LITE overlay by exact skill name.',
                inputSchema: {
                  type: 'object',
                  properties: {
                    name: { type: 'string', description: 'Exact skill directory name.' },
                  },
                  required: ['name'],
                },
              },
            ]
          : []),
        {
          name: 'fw_start_pipeline',
          description:
            'Initialize the Forgewright pipeline for a new project/session. Use this when the user specifies a goal (e.g. Build a SaaS, add a feature).',
          inputSchema: {
            type: 'object',
            properties: {
              mode: {
                type: 'string',
                description:
                  'The run mode, e.g. "Full Build", "Feature", "Harden", "Mobile", "Game Build".',
              },
            },
            required: ['mode'],
          },
        },
        {
          name: 'fw_get_current_phase',
          description:
            'Get the current phase of the Forgewright pipeline and its locked status. Use this to determine which skill to load.',
          inputSchema: {
            type: 'object',
            properties: {},
          },
        },
        {
          name: 'fw_advance_to_next_phase',
          description:
            'Transition to the next phase in the pipeline (e.g. from Research -> Execution). Blocks if waiting for a HITL gate.',
          inputSchema: {
            type: 'object',
            properties: {},
          },
        },
        {
          name: 'fw_request_gate_approval',
          description:
            'Lock the pipeline when you have completed work and need the explicit human user to approve it before continuing to the next phase. This is mandatory for production-grade robustness.',
          inputSchema: {
            type: 'object',
            properties: {
              message: {
                type: 'string',
                description:
                  'A clear explanation of what you just finished (e.g. "GDD is ready") and what the user needs to approve.',
              },
              qualityGate: {
                type: 'object',
                description: 'Optional quality gate details.',
                properties: {
                  score: { type: 'number' },
                  threshold: { type: 'number' },
                  failedCriteria: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        name: { type: 'string' },
                        score: { type: 'number' },
                        reason: { type: 'string' },
                      },
                      required: ['name', 'score', 'reason'],
                    },
                  },
                },
                required: ['score', 'threshold', 'failedCriteria'],
              },
            },
            required: ['message'],
          },
        },
        {
          name: 'fw_approve_gate',
          description:
            'Call this ONLY when the user says "I approve" or "Looks good". Unlocks the pipeline.',
          inputSchema: {
            type: 'object',
            properties: {},
          },
        },
        {
          name: 'fw_update_subtask',
          description:
            'Update the inner action details and progress of the current pipeline phase.',
          inputSchema: {
            type: 'object',
            properties: {
              activeAction: {
                type: ['string', 'null'],
                description:
                  'A detailed description of the currently running sub-task (e.g., "Running Vitest...").',
              },
              phaseProgress: {
                type: ['number', 'null'],
                description: 'The progress score of the current phase (0.0 to 1.0).',
              },
            },
            required: ['activeAction', 'phaseProgress'],
          },
        },
        {
          name: 'fw_update_self_healing',
          description: 'Update the self-healing status (ASIP Loop) of the pipeline.',
          inputSchema: {
            type: 'object',
            properties: {
              selfHealing: {
                type: ['object', 'null'],
                description: 'The self-healing detail object, or null to clear healing status.',
                properties: {
                  isHealing: { type: 'boolean' },
                  currentAttempt: { type: 'number' },
                  maxAttempts: { type: 'number' },
                  lastError: { type: 'string' },
                },
                required: ['isHealing', 'currentAttempt', 'maxAttempts'],
              },
            },
            required: ['selfHealing'],
          },
        },
        {
          name: 'fw_fail_pipeline',
          description:
            'Set the pipeline status to FAILED and record the reason in the execution history.',
          inputSchema: {
            type: 'object',
            properties: {
              reason: {
                type: 'string',
                description: 'Reason for the pipeline failure.',
              },
            },
          },
        },
        {
          name: 'fw_log_token_usage',
          description: 'Log LLM token usage details for Console UI tracking.',
          inputSchema: {
            type: 'object',
            properties: {
              inputTokens: { type: 'number', description: 'Prompt/input tokens' },
              outputTokens: { type: 'number', description: 'Completion/output tokens' },
              model: { type: 'string', description: 'Model name' },
              provider: { type: 'string', description: 'Provider name' },
              cost: { type: 'number', description: 'USD Cost (optional)' },
              skill: { type: 'string', description: 'Skill name' },
            },
            required: ['inputTokens', 'outputTokens', 'model', 'provider', 'skill'],
          },
        },
        {
          name: 'fw_update_status_and_log_usage',
          description:
            'Update the active subtask action, phase progress, and log token usage in a single call.',
          inputSchema: {
            type: 'object',
            properties: {
              activeAction: {
                type: ['string', 'null'],
                description: 'A detailed description of the currently running sub-task.',
              },
              phaseProgress: {
                type: ['number', 'null'],
                description: 'The progress score of the current phase (0.0 to 1.0).',
              },
              inputTokens: { type: 'number', description: 'Prompt/input tokens' },
              outputTokens: { type: 'number', description: 'Completion/output tokens' },
              model: { type: 'string', description: 'Model name' },
              provider: { type: 'string', description: 'Provider name' },
              cost: { type: 'number', description: 'USD Cost (optional)' },
              skill: { type: 'string', description: 'Skill name' },
            },
            required: ['inputTokens', 'outputTokens', 'model', 'provider', 'skill'],
          },
        },
        {
          name: 'fw_check_pipeline_compliance',
          description:
            'Check whether Forgewright pipeline activation state is healthy and not stale. Use before closing substantial work.',
          inputSchema: {
            type: 'object',
            properties: {
              maxStateAgeMinutes: {
                type: 'number',
                description: 'Maximum acceptable active pipeline state age in minutes.',
              },
            },
          },
        },
      ],
    };
  });

  server.setRequestHandler(
    CallToolRequestSchema,
    async (request) =>
      toolGateway.execute(
        {
          name: request.params.name,
          arguments: (request.params.arguments ?? {}) as Record<string, unknown>,
          sessionId,
          turnNumber: ++turnNumber,
        },
        async () => {
          try {
            if (request.params.name === 'fw_load_skill_overlay') {
              const name = request.params.arguments?.name;
              if (typeof name !== 'string') {
                return { isError: true, content: [{ type: 'text', text: 'INVALID_SKILL_NAME' }] };
              }
              if (!deferredSkillNames.has(name)) {
                return {
                  isError: true,
                  content: [{ type: 'text', text: 'SKILL_OVERLAY_NOT_ALLOWED' }],
                };
              }
              if (loadedSkills.has(name)) {
                return {
                  isError: true,
                  content: [{ type: 'text', text: 'SKILL_OVERLAY_ALREADY_LOADED' }],
                };
              }
              try {
                const overlay = loadSkillOverlay(name);
                loadedSkills.add(name);
                return {
                  content: [{ type: 'text', text: overlay.content }],
                  structuredContent: {
                    name: overlay.name,
                    digest: overlay.digest,
                    bytes: overlay.bytes,
                    tokens: overlay.tokens,
                  },
                };
              } catch (error) {
                const code = error instanceof SkillOverlayError ? error.code : 'UNKNOWN_SKILL';
                return { isError: true, content: [{ type: 'text', text: code }] };
              }
            }
            if (request.params.name === 'fw_start_pipeline') {
              const result = await startPipeline(request.params.arguments?.mode as string);
              return { content: [{ type: 'text', text: result }] };
            }

            if (request.params.name === 'fw_get_current_phase') {
              const state = await getState();
              const phaseName = PIPELINE_PHASES[state.currentPhase] || 'Unknown Phase';
              let msg = `Mode: ${state.currentMode || 'None'}\nPhase: ${phaseName}\nStatus: ${state.status}`;

              if (state.activeAction) {
                msg += `\nActive Action: ${state.activeAction}`;
              }
              if (typeof state.phaseProgress === 'number') {
                msg += `\nPhase Progress: ${(state.phaseProgress * 100).toFixed(0)}%`;
              }
              if (state.selfHealing && state.selfHealing.isHealing) {
                msg += `\nSelf-Healing: Attempt ${state.selfHealing.currentAttempt}/${state.selfHealing.maxAttempts}`;
                if (state.selfHealing.lastError) {
                  msg += `\nLast Error: ${state.selfHealing.lastError}`;
                }
              }
              if (state.status === 'WAITING_FOR_GATE' && state.qualityGate) {
                msg += `\nQuality Gate Score: ${state.qualityGate.score}/${state.qualityGate.threshold}`;
                if (
                  state.qualityGate.failedCriteria &&
                  state.qualityGate.failedCriteria.length > 0
                ) {
                  msg += `\nFailed Criteria:`;
                  for (const item of state.qualityGate.failedCriteria) {
                    msg += `\n  - ${item.name} (Score: ${item.score}, Reason: ${item.reason})`;
                  }
                }
              }

              msg += `\n\nWarning: If status is WAITING_FOR_GATE, wait for user input. Do not start next step.`;
              return { content: [{ type: 'text', text: msg }] };
            }

            if (request.params.name === 'fw_advance_to_next_phase') {
              const result = await advancePhase();
              return { content: [{ type: 'text', text: result }] };
            }

            if (request.params.name === 'fw_request_gate_approval') {
              const message = request.params.arguments?.message as string;
              const qualityGate = request.params.arguments?.qualityGate as
                QualityGateState | undefined;
              const result = await requestGateApproval(message, qualityGate);
              return { content: [{ type: 'text', text: result }] };
            }

            if (request.params.name === 'fw_approve_gate') {
              const result = await approveGate();
              return { content: [{ type: 'text', text: result }] };
            }

            if (request.params.name === 'fw_update_subtask') {
              const activeAction = request.params.arguments?.activeAction as string | null;
              const phaseProgress = request.params.arguments?.phaseProgress as number | null;
              await updateSubTask(activeAction, phaseProgress);
              return {
                content: [
                  {
                    type: 'text',
                    text: `Sub-task details updated to: action="${activeAction}", progress=${phaseProgress}`,
                  },
                ],
              };
            }

            if (request.params.name === 'fw_update_self_healing') {
              const selfHealing = request.params.arguments?.selfHealing as SelfHealingState | null;
              await updateSelfHealing(selfHealing);
              return {
                content: [
                  {
                    type: 'text',
                    text: selfHealing
                      ? `Self-healing status updated: attempt ${selfHealing.currentAttempt}/${selfHealing.maxAttempts}`
                      : 'Self-healing status cleared.',
                  },
                ],
              };
            }

            if (request.params.name === 'fw_fail_pipeline') {
              const reason = request.params.arguments?.reason as string | undefined;
              const result = await failPipeline(reason);
              return { content: [{ type: 'text', text: result }] };
            }

            if (request.params.name === 'fw_log_token_usage') {
              const inputTokens = request.params.arguments?.inputTokens as number;
              const outputTokens = request.params.arguments?.outputTokens as number;
              const model = request.params.arguments?.model as string;
              const provider = request.params.arguments?.provider as string;
              const cost = request.params.arguments?.cost as number | undefined;
              const skill = request.params.arguments?.skill as string;

              logTokenUsage({
                inputTokens,
                outputTokens,
                model,
                provider,
                cost: cost ?? null,
                timestamp: new Date().toISOString(),
                skill,
              });
              return {
                content: [
                  { type: 'text', text: `Token usage logged successfully for skill "${skill}".` },
                ],
              };
            }

            if (request.params.name === 'fw_update_status_and_log_usage') {
              const activeAction = request.params.arguments?.activeAction as string | null;
              const phaseProgress = request.params.arguments?.phaseProgress as number | null;
              const inputTokens = request.params.arguments?.inputTokens as number;
              const outputTokens = request.params.arguments?.outputTokens as number;
              const model = request.params.arguments?.model as string;
              const provider = request.params.arguments?.provider as string;
              const cost = request.params.arguments?.cost as number | undefined;
              const skill = request.params.arguments?.skill as string;

              if (activeAction !== undefined || phaseProgress !== undefined) {
                await updateSubTask(activeAction ?? null, phaseProgress ?? null);
              }

              logTokenUsage({
                inputTokens,
                outputTokens,
                model,
                provider,
                cost: cost ?? null,
                timestamp: new Date().toISOString(),
                skill,
              });

              return {
                content: [
                  {
                    type: 'text',
                    text: `Status updated and token usage logged successfully for skill "${skill}".`,
                  },
                ],
              };
            }

            if (request.params.name === 'fw_check_pipeline_compliance') {
              const maxStateAgeMinutes =
                (request.params.arguments?.maxStateAgeMinutes as number | undefined) ?? 120;
              const report = await checkPipelineCompliance(maxStateAgeMinutes);
              return { content: [{ type: 'text', text: JSON.stringify(report, null, 2) }] };
            }

            throw new Error(`Tool not found: ${request.params.name}`);
          } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : String(e);
            return {
              isError: true,
              content: [{ type: 'text', text: `Failed to execute: ${msg}` }],
            };
          }
        },
      ) as Promise<never>,
  );
}
