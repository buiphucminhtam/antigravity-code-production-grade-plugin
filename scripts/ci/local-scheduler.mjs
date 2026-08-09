#!/usr/bin/env node
import { spawnSync } from 'node:child_process';

const candidates = process.platform === 'win32'
  ? [
      ['py', ['-3.13']], ['py', ['-3.12']], ['py', ['-3.11']], ['py', ['-3']],
      ['python3.13', []], ['python3.12', []], ['python3.11', []], ['python', []], ['python3', []],
    ]
  : [['python3.13', []], ['python3.12', []], ['python3.11', []], ['python3', []], ['python', []]];

for (const [command, prefix] of candidates) {
  const probe = spawnSync(
    command,
    [...prefix, '-c', 'import sys; raise SystemExit(0 if sys.version_info >= (3,11) else 1)'],
    { stdio: 'ignore', shell: false },
  );
  if (!probe.error && probe.status === 0) {
    const result = spawnSync(command, [...prefix, 'scripts/ci/local-scheduler.py', ...process.argv.slice(2)], {
      stdio: 'inherit',
      shell: false,
    });
    process.exit(result.status ?? 1);
  }
}

console.error('Forgewright local scheduler requires Python 3.11+.');
process.exit(6);
