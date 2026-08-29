import fs from 'fs';
import path from 'path';
import { ListPromptsRequestSchema, GetPromptRequestSchema, } from '@modelcontextprotocol/sdk/types.js';
import { getAllSkills, loadSkillOverlay } from '../parsers/skill-parser.js';
import { getWorkspaceRoot } from '../state/pipeline-manager.js';
function getDesignMdContent() {
    try {
        const wsRoot = getWorkspaceRoot();
        const designMdPath = path.join(wsRoot, 'DESIGN.md');
        if (fs.existsSync(designMdPath)) {
            return fs.readFileSync(designMdPath, 'utf-8');
        }
    }
    catch (e) {
        console.error('[Forgewright Global MCP] Failed to read DESIGN.md:', e);
    }
    return '';
}
export function registerPrompts(server) {
    server.setRequestHandler(ListPromptsRequestSchema, async () => {
        const skills = getAllSkills();
        return {
            prompts: [
                // Always include the production-grade orchestrator first
                {
                    name: 'fw_orchestrator',
                    description: 'Load Forgewright Orchestrator — the main skill that routes all requests to the correct domain skill.',
                    arguments: [],
                },
                // Then all domain skills
                ...skills.map((skill) => ({
                    name: `fw_skill_${skill.name}`,
                    description: `Load Forgewright Skill: ${skill.name}. ${skill.description}`,
                    arguments: [],
                })),
            ],
        };
    });
    server.setRequestHandler(GetPromptRequestSchema, async (request) => {
        const skills = getAllSkills();
        const promptName = request.params.name;
        // Handle orchestrator
        if (promptName === 'fw_orchestrator') {
            const orchestratorSkill = skills.find((s) => s.name === 'production-grade');
            if (orchestratorSkill) {
                const content = orchestratorSkill.content ?? loadSkillOverlay(orchestratorSkill.name).content;
                let text = `Please operate as the Forgewright Orchestrator. Load and follow the production-grade skill instructions.\n\n${content}`;
                const designMd = getDesignMdContent();
                if (designMd) {
                    text += `\n\n[MANDATORY DESIGN SOURCE-OF-TRUTH: DESIGN.md]\nA DESIGN.md file has been detected at the root of the workspace. You and all downstream skills MUST strictly follow its design tokens, colors, typography, layout, and styling rules when planning, designing, or implementing UIs:\n\n${designMd}`;
                }
                return {
                    description: orchestratorSkill.description,
                    messages: [
                        {
                            role: 'user',
                            content: {
                                type: 'text',
                                text: text,
                            },
                        },
                    ],
                };
            }
        }
        // Handle individual skills
        const skill = skills.find((s) => `fw_skill_${s.name}` === promptName);
        if (skill) {
            const content = skill.content ?? loadSkillOverlay(skill.name).content;
            let text = `Please operate as the following Forgewright Skill:\n\n${content}\n\nExecute the duties for this role based on the current context.`;
            const stylingSkills = [
                'ui-designer',
                'frontend-engineer',
                'ux-researcher',
                'qa-engineer',
                'software-engineer',
                'accessibility-engineer',
            ];
            if (stylingSkills.includes(skill.name)) {
                const designMd = getDesignMdContent();
                if (designMd) {
                    text += `\n\n[MANDATORY DESIGN SOURCE-OF-TRUTH: DESIGN.md]\nA DESIGN.md file has been detected at the root of the workspace. You MUST strictly follow its design tokens, colors, typography, layout, and component specifications when executing your role:\n\n${designMd}`;
                }
            }
            return {
                description: skill.description,
                messages: [
                    {
                        role: 'user',
                        content: {
                            type: 'text',
                            text: text,
                        },
                    },
                ],
            };
        }
        throw new Error(`Forgewright Skill or Prompt not found: ${promptName}`);
    });
}
