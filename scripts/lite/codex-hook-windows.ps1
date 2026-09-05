[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateSet("SessionStart", "SubagentStart", "Stop")]
    [string]$EventName,

    [string]$ProjectRoot
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$frameworkRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..\..")).Path
$candidateProjectRoot = if ($ProjectRoot) {
    (Resolve-Path -LiteralPath $ProjectRoot).Path
} else {
    $null
}
$pythonExecutable = $null
$pythonPrefix = @()
$pythonCandidates = @()

$launcher = Get-Command py.exe -ErrorAction SilentlyContinue
if ($null -ne $launcher) {
    foreach ($selector in @("-3.13", "-3.12", "-3.11", "-3")) {
        $pythonCandidates += [pscustomobject]@{
            Executable = $launcher.Source
            Prefix = @($selector)
        }
    }
}
foreach ($candidate in @("python3.exe", "python.exe")) {
    $launcher = Get-Command $candidate -ErrorAction SilentlyContinue
    if ($null -ne $launcher) {
        $pythonCandidates += [pscustomobject]@{
            Executable = $launcher.Source
            Prefix = @()
        }
    }
}

foreach ($candidate in $pythonCandidates) {
    try {
        & $candidate.Executable @($candidate.Prefix) -c "import sys; raise SystemExit(0 if sys.version_info >= (3, 11) else 1)" *> $null
        if ($LASTEXITCODE -eq 0) {
            $pythonExecutable = $candidate.Executable
            $pythonPrefix = @($candidate.Prefix)
            break
        }
    } catch {
        continue
    }
}

if ($null -eq $pythonExecutable) {
    if ($EventName -eq "Stop") {
        Write-Error "Forgewright Stop requires Python 3.11 or newer on Windows."
        exit 1
    }
    exit 0
}

$contextHook = Join-Path $PSScriptRoot "rule-context-hook.py"

if ($EventName -eq "Stop") {
    $resolvedProjectRoot = if ($candidateProjectRoot) {
        $candidateProjectRoot
    } else {
        $frameworkRoot
    }
    $stopGate = Join-Path $resolvedProjectRoot "scripts\lite\stop_gate.py"
    if (-not (Test-Path -LiteralPath $stopGate -PathType Leaf)) {
        Write-Error "Forgewright Stop runtime is missing."
        exit 1
    }
    & $pythonExecutable @pythonPrefix $stopGate --platform CODEX --typed-stop-decision
    exit $LASTEXITCODE
}

if (-not (Test-Path -LiteralPath $contextHook -PathType Leaf)) {
    exit 0
}
$resolvedProjectRoot = $frameworkRoot
if ($candidateProjectRoot) {
    $validationScript = @'
import importlib.util
import sys
from pathlib import Path

spec = importlib.util.spec_from_file_location("forgewright_rule_context_hook", sys.argv[1])
if spec is None or spec.loader is None:
    raise SystemExit(1)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
module.load_manifest(Path(sys.argv[2]))
'@
    try {
        & $pythonExecutable @pythonPrefix -c $validationScript $contextHook $candidateProjectRoot *> $null
        if ($LASTEXITCODE -eq 0) {
            $resolvedProjectRoot = $candidateProjectRoot
        }
    } catch {
        $resolvedProjectRoot = $frameworkRoot
    }
}
& $pythonExecutable @pythonPrefix $contextHook --workspace $resolvedProjectRoot --platform CODEX --event $EventName
exit 0
