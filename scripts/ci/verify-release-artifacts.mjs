#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { execNpmSync } from './native-node-commands.mjs';
import { mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

const directory = process.argv[2];
if (!directory) throw new Error('usage: verify-release-artifacts.mjs <artifact-directory>');
const archives = readdirSync(directory).filter((file) => file.endsWith('.tgz')).map((file) => join(directory, file));
if (archives.length !== 2) throw new Error(`expected exactly two package archives, found ${archives.length}`);

const expected = new Map([
  ['forgewright-mcp-global', 'build/index.js'],
  ['@forgewright/cli', 'dist/index.js'],
]);
const scratch = mkdtempSync(join(tmpdir(), 'forgewright-release-smoke-'));
try {
  const observed = new Set();
  for (const archive of archives) {
    const destination = join(scratch, basename(archive, '.tgz'));
    mkdirSync(destination);
    execFileSync('tar', ['-xzf', archive, '-C', destination], { stdio: 'pipe' });
    const packageRoot = join(destination, 'package');
    const metadata = JSON.parse(execFileSync('tar', ['-xOf', archive, 'package/package.json'], { encoding: 'utf8' }));
    const entrypoint = expected.get(metadata.name);
    if (!entrypoint) throw new Error(`unexpected release package ${metadata.name}`);
    observed.add(metadata.name);
    execFileSync(process.execPath, ['--check', join(packageRoot, entrypoint)], { stdio: 'pipe' });
    if (metadata.name === '@forgewright/cli') {
      execNpmSync(['install', '--omit=dev', '--ignore-scripts', '--package-lock=false', '--no-audit', '--no-fund'], { cwd: packageRoot, stdio: 'pipe' });
      execFileSync(process.execPath, [join(packageRoot, entrypoint), '--help'], { stdio: 'pipe' });
    }
  }
  for (const name of expected.keys()) if (!observed.has(name)) throw new Error(`missing release package ${name}`);
  console.log(`release artifact smoke: PASS (${[...observed].sort().join(', ')})`);
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
