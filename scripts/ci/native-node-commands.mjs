import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

function windowsNpmCli() {
  const candidates = [
    process.env.npm_execpath,
    join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  ];
  for (const candidate of candidates) {
    if (candidate && existsSync(candidate)) return candidate;
  }
  throw new Error('native npm CLI entrypoint is unavailable');
}

export function nativeNpmInvocation(args = []) {
  if (!Array.isArray(args) || args.some((arg) => typeof arg !== 'string')) {
    throw new TypeError('npm argv must be an array of strings');
  }
  if (process.platform !== 'win32') {
    return { command: 'npm', args: [...args] };
  }
  return {
    command: process.execPath,
    args: [windowsNpmCli(), ...args],
  };
}

export function execNpmSync(args, options = {}) {
  const invocation = nativeNpmInvocation(args);
  return execFileSync(invocation.command, invocation.args, options);
}
