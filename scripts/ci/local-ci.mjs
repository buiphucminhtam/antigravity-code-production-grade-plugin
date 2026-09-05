#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('../../', import.meta.url));
const args = process.argv.slice(2);
const dedicated = { 'product-factory': 'verify-product-factory.py', roadmap: 'verify-roadmap-completion.py', platform: 'verify-platform.py' };
const selected = Object.hasOwn(dedicated, args[0]) ? dedicated[args.shift()] : 'local-ci.py';

const candidates = process.platform === 'win32'
  ? [
      ['py', ['-3.13']], ['py', ['-3.12']], ['py', ['-3.11']], ['py', ['-3']],
      ['python3.13', []], ['python3.12', []], ['python3.11', []], ['python', []], ['python3', []],
    ]
  : [['python3.13', []], ['python3.12', []], ['python3.11', []], ['python3', []], ['python', []]];

if (selected !== 'local-ci.py') {
  for (const directory of ['.forgewright/local-ci-venv', '.forgewright/runtime/ci-venv']) {
    const python = join(root, directory, process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
    if (existsSync(python)) candidates.unshift([python, []]);
  }
}

for (const [command, prefix] of candidates) {
  const probe = spawnSync(
    command,
    [...prefix, '-c', 'import sys; raise SystemExit(0 if sys.version_info >= (3,11) else 1)'],
    { stdio: 'ignore', shell: false, timeout: 10000 },
  );
  if (!probe.error && probe.status === 0) {
    const result = spawnSync(command, [...prefix, join(root, 'scripts/ci', selected), ...args], {
      stdio: 'inherit',
      shell: false,
      cwd: root,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
    });
    process.exit(result.status ?? 1);
  }
}

console.error('Forgewright local CI requires Python 3.11+ (python3/python or py -3).');
process.exit(6);
