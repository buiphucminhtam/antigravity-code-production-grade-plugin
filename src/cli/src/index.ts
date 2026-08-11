/**
 * Forgewright CLI - Agent-First Command Line Interface
 *
 * Dual-purpose:
 * • Humans: colored pretty output, spinners, sensible defaults
 * • Agents: --json for structured envelopes, non-TTY auto-detection, stable exit codes
 */
import { Command } from "commander";
import { registerGlobalFlags } from "./core/global-flags.js";
import { registerToolsCommands } from "./commands/tools.js";
import { registerSkillsCommands } from "./commands/skills.js";
import { registerToolsCallCommand } from "./commands/tools-call.js";
import { registerConfigCommands } from "./commands/config.js";
import { registerDoctorCommand } from "./commands/doctor.js";
import { registerValidateCommand } from "./commands/validate.js";
import { registerCompletionCommand } from "./commands/completion.js";
import { registerCoordsCommand } from "./commands/coords.js";
import { registerAutonomousTestCommand } from "./commands/test.js";
import { registerExpertCommand } from "./commands/expert.js";
import { registerTokenCommand } from "./commands/token.js";
import {
  maybeNotifyAutoDelegation,
  registerDelegateCommand,
} from "./commands/delegate.js";
import { registerBenchCommand } from "./commands/bench.js";
import { registerProjectCommands } from "./commands/project.js";
import { registerDocsCommands } from "./commands/docs.js";
import { VERSION } from "./version.js";
import { EXIT_CODES } from "./exit-codes.js";
import pc from "picocolors";
import { getConfig } from "./config/store.js";

export function buildProgram(): Command {
  const program = new Command();

  program
    .name("forge")
    .description("Forgewright CLI - Agent-First Command Line Interface")
    .version(VERSION, "-V, --version");

  // Register global flags
  registerGlobalFlags(program);

  // Register command groups
  registerToolsCommands(program);
  registerSkillsCommands(program);
  registerToolsCallCommand(program);
  registerConfigCommands(program);
  registerDoctorCommand(program);
  registerValidateCommand(program);
  registerCompletionCommand(program);
  registerCoordsCommand(program);
  registerAutonomousTestCommand(program);
  registerExpertCommand(program);
  registerTokenCommand(program);
  registerDelegateCommand(program);
  registerBenchCommand(program);
  registerProjectCommands(program);
  registerDocsCommands(program);

  // Initialize config
  const config = getConfig();
  config.loadUserConfig();
  config.loadEnvFiles(process.cwd());
  config.loadEnvVars();

  // Add examples help text
  program.addHelpText(
    "after",
    `
Examples:
  $ forge tools list                  # List all tools
  $ forge tools list --json           # JSON output for agents
  $ forge tools list --category engineering  # Filter by category
  $ forge skills list                 # List all skills
  $ forge skills search api           # Search skills
  $ forge expert status               # Show optional Claude/Codex CLI expert mode
  $ forge expert use codex --track-tokens  # Switch expert mode to Codex CLI
  $ forge token on                    # Enable local token tracking
  $ forge token report --period week  # Show local token usage summary
  $ forge delegate status             # Show auto-detected controller/worker state
  $ forge delegate auto               # Auto-enable when Codex/Claude + Agy are available
  $ forge docs init .                 # Create a privacy-safe docs manifest
  $ forge docs build .                # Build the static documentation portal
  $ forge --version                   # Show version

Agent Mode:
  $ forge --json tools list | jq .    # Parse JSON output
  $ forge --json tools list | jq '.data.tools[].name'
  $ for tool in $(forge --json tools list | jq -r '.data.tools[].name'); do
      echo "Tool: $tool"
    done

Environment Variables:
  FORGE_DEBUG=1                       # Enable debug mode
  NO_COLOR=1                          # Disable colors
  FORGE_LEGACY_OUTPUT=1               # Force legacy output mode
`,
  );

  return program;
}

export async function main(): Promise<void> {
  const program = buildProgram();
  maybeNotifyAutoDelegation();

  try {
    // Parse arguments
    await program.parseAsync(process.argv);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    if (!process.stdout.isTTY) {
      const envelope = {
        ok: false,
        tool: "cli",
        data: null,
        metadata: {
          duration_ms: 0,
          version: VERSION,
        },
        error: {
          code: EXIT_CODES.INTERNAL_ERROR,
          message,
        },
      };
      process.stdout.write(JSON.stringify(envelope) + "\n");
    } else {
      process.stderr.write(`${pc.red("Error:")} ${message}\n`);
    }

    process.exit(EXIT_CODES.INTERNAL_ERROR);
  }
}

// Run if executed directly
main();
