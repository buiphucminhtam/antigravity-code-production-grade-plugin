"""Native Node launchers preserve argv and do not require Windows batch execution."""

from pathlib import Path
import json
import shutil
import subprocess

ROOT = Path(__file__).resolve().parents[2]


def run_node(source: str, *args: str) -> dict:
    node = shutil.which("node")
    assert node, "Node is required by the declared local CI environment"
    result = subprocess.run(
        [node, "--input-type=module", "-e", source, *args],
        cwd=ROOT,
        text=True,
        encoding="utf-8",
        capture_output=True,
        timeout=20,
        check=False,
    )
    assert result.returncode == 0, result.stderr
    return json.loads(result.stdout)


def test_windows_npm_uses_node_and_preserves_literal_arguments(tmp_path: Path) -> None:
    fixture = tmp_path / "npm path with spaces" / "npm-cli.js"
    fixture.parent.mkdir()
    fixture.write_text(
        "process.stdout.write(JSON.stringify(process.argv.slice(2)));\n",
        encoding="utf-8",
    )
    payload = [
        "space here",
        'quote"value',
        "& echo not-a-command",
        "%PATH%",
        "line\nbreak",
    ]
    source = r"""
        import assert from 'node:assert/strict';
        import { nativeNpmInvocation, execNpmSync } from './scripts/ci/native-node-commands.mjs';
        Object.defineProperty(process, 'platform', { value: 'win32' });
        process.env.npm_execpath = process.argv[1];
        const args = JSON.parse(process.argv[2]);
        const invocation = nativeNpmInvocation(args);
        assert.equal(invocation.command, process.execPath);
        assert.deepEqual(invocation.args, [process.argv[1], ...args]);
        const observed = JSON.parse(execNpmSync(args, { encoding: 'utf8' }));
        assert.deepEqual(observed, args);
        console.log(JSON.stringify({ status: 'PASS', observed }));
    """
    assert run_node(source, str(fixture), json.dumps(payload))["observed"] == payload


def test_mcp_vitest_limits_isolated_forks_for_shared_native_hosts() -> None:
    source = r"""
        import assert from 'node:assert/strict';
        import { loadConfigFromFile } from 'vite';
        const loaded = await loadConfigFromFile(
            { command: 'serve', mode: 'test' }, 'mcp/vitest.config.ts',
        );
        assert.ok(loaded);
        assert.equal(loaded.config.test.pool, 'forks');
        assert.equal(loaded.config.test.isolate, true);
        assert.equal(loaded.config.test.poolOptions.forks.minForks, 1);
        assert.equal(loaded.config.test.poolOptions.forks.maxForks, 2);
        console.log(JSON.stringify({ status: 'PASS' }));
    """
    assert run_node(source)["status"] == "PASS"


def test_native_npm_validates_argv_before_starting_a_process() -> None:
    source = r"""
        import assert from 'node:assert/strict';
        import { nativeNpmInvocation } from './scripts/ci/native-node-commands.mjs';
        for (const input of ['run build', [1], [null], {}]) {
            assert.throws(() => nativeNpmInvocation(input), TypeError);
        }
        Object.defineProperty(process, 'platform', { value: 'darwin' });
        assert.deepEqual(nativeNpmInvocation(['run', 'build']), {
            command: 'npm', args: ['run', 'build'],
        });
        console.log(JSON.stringify({ status: 'PASS' }));
    """
    assert run_node(source)["status"] == "PASS"


def test_mcp_format_accepts_host_line_endings_but_rejects_bad_format() -> None:
    source = r"""
        import assert from 'node:assert/strict';
        import * as prettier from 'prettier';
        const filepath = 'mcp/src/native-line-ending-probe.ts';
        const options = { ...await prettier.resolveConfig(filepath), filepath };
        const formatted = await prettier.format('const answer=42;', { ...options, endOfLine: 'lf' });
        assert.equal(await prettier.check(formatted, options), true);
        assert.equal(await prettier.check(formatted.replaceAll('\n', '\r\n'), options), true);
        assert.equal(await prettier.check('const answer=42;', options), false);
        console.log(JSON.stringify({ status: 'PASS' }));
    """
    assert run_node(source)["status"] == "PASS"
