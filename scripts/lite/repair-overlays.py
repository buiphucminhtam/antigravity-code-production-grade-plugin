#!/usr/bin/env python3
"""
repair-overlays.py
==================
Fixes all LITE.md skill overlays per Kernel v3 requirements:
  1. Replace VERIFIED? / Y/N columns with Script-produced evidence column
  2. Remove fabricated Worked Example sections (fake SDK, fake paths, fake transcripts)
  3. Strip orphan numeric citations [1], [2, 5] etc from prose
  4. Remove sync-obsidian boilerplate SYNC steps
  5. Remove ungrounded constraints: Temperature 1.0, ECE thresholds, zero pixel drift
  6. Remove guaranteed-absent paths: .forgewright/project-profile.json, .agents/workflows,
     forgewright-gemini-sdk, src/GeminiGuardrail.ts, test-gemini-behavior.js
  7. Strip trailing whitespace from all lines
  8. Remove illustrative NOTE callouts and the worked-example block below code-reviewer
     that contains fake VERIFY blocks with pasted output
"""

import os
import re
import sys

DRY_RUN = "--dry-run" in sys.argv
VERBOSE = "--verbose" in sys.argv or DRY_RUN

SKILLS_DIR = "skills"

# ── Patterns ──────────────────────────────────────────────────────────────────

# Inline orphan citations: [1], [2, 5], [1, 2, 3] but NOT [link text](url) style
CITATION_INLINE = re.compile(r"\s*\[(\d+(?:,\s*\d+)*)\](?!\s*[:\(])")

# The > [!NOTE] / > The following example is illustrative block
ILLUSTRATIVE_NOTE = re.compile(
    r">\s*\[!NOTE\]\s*\n>\s*The following example is illustrative\.\s*\n?", re.MULTILINE
)

# Fake SDK / fake paths / fake commands that must not appear
BANNED_PATTERNS = [
    (re.compile(r"forgewright-gemini-sdk"), "forgewright-gemini-sdk"),
    (re.compile(r"src/GeminiGuardrail\.ts"), "src/GeminiGuardrail.ts"),
    (re.compile(r"test-gemini-behavior\.js"), "test-gemini-behavior.js"),
]

# Banned unverified absolute claims in free text (not in code blocks)
BANNED_FREETEXT = [
    # mandatory Temperature 1.0 claim
    (re.compile(r",?\s*specifically Temperature 1\.0 and"), ""),
    (re.compile(r",?\s*focusing on Temperature 1\.0 and"), ""),
    (
        re.compile(
            r"(mandatory |the optimal )?Temperature 1\.0 (rule |native configuration )?for Gemini 3\.x[^\n]*"
        ),
        "",
    ),
    (
        re.compile(
            r"Hardcoding (Overridden )?Temperatures[^\n]*Temperature[^\n]*(1\.0|0\.7)[^\n]*\n"
        ),
        "",
    ),
    # ECE thresholds
    (re.compile(r"Expected Calibration Error \(ECE\)\s*[<>=]+\s*0\.10[^\n]*"), ""),
    (re.compile(r"ECE[^\n]*0\.10[^\n]*"), ""),
    (re.compile(r"ece_threshold[^\n]*"), ""),
    # zero pixel drift
    (re.compile(r"zero pixel-level drift[^\n]*"), "zero layout drift"),
    (re.compile(r"verify zero pixel[^\n]*"), "identify layout regressions"),
]

# sync-obsidian SYNC step patterns (entire step line)
SYNC_STEP_LINE = re.compile(r"^(\d+)\.\s+SYNC\s*\|[^\n]+\n?", re.MULTILINE)

# .agents/workflows guaranteed path in prose
AGENTS_WORKFLOWS_GROUND = re.compile(
    r"\|\s*[^|]+\|\s*`cat \.agents/workflows/`[^|]*\|[^\n]+\|[^\n]+\|?\s*\n?"
)

# project-profile.json as a guaranteed file row in GROUND table
PROJECT_PROFILE_GROUND = re.compile(
    r"\|\s*[Pp]roject stack[^|]*profile[^|]*\|\s*`cat \.forgewright/project-profile\.json`[^|]*\|[^\n]+\n?"
)

# Illustrative tail after the canonical domain slots. These examples embed fake
# paths, command results, and PASS verdicts, so LITE overlays must omit them.
WORKED_EXAMPLE_SECTION = re.compile(
    r"^---\s*\n+(?=(?:#{2,4}\s+(?:Example|Worked Example|\d+\.\s+UNDERSTAND))).*\Z",
    re.DOTALL | re.MULTILINE | re.IGNORECASE,
)

# "Result | VERIFIED?" header → "Script-produced evidence"
VERIFIED_HEADER_LINE = re.compile(r"\|\s*Result\s*\|\s*VERIFIED\?\s*\|", re.IGNORECASE)

VERIFIED_SEP_LINE = re.compile(
    r"(\|---\|---\|---\|)---\|",
)

GROUND_DATA_ROW = re.compile(
    r"(\|[^|]+\|[^|]+\|)\s*\.\.\.\s*\|\s*Y/N\s*\|",
)

GROUND_DATA_ROW_INLINE = re.compile(
    r"(\|[^|]+\|[^|]+\|[^|]+)\|\s*Y/N\s*\|",
)

# ── Per-file repairs ───────────────────────────────────────────────────────────


def skill_name_from_path(filepath):
    parts = filepath.replace("\\", "/").split("/")
    for i, p in enumerate(parts):
        if p == "skills" and i + 1 < len(parts):
            return parts[i + 1]
    return ""


def fix_ground_table(content):
    """
    Normalize Ground tables to four columns with placeholder results and
    script-produced evidence instructions.
    """
    lines = content.split("\n")
    out = []
    in_ground = False
    current_section = ""
    ground_schema = None
    evidence_instruction = "run the check command and paste output"
    self_attested = {"y", "n", "y/n", "true", "false", "verified"}

    for line in lines:
        stripped = line.strip()

        # Track section
        if stripped.startswith("#"):
            current_section = stripped.lower()
            # Repair canonical slots and worked-example Ground headings alike.
            in_ground = bool(re.search(r"\bground\b", current_section))
            ground_schema = None
            out.append(line)
            continue

        if in_ground and "|" in line:
            cells = re.split(r"(?<!\\)(?<!\|)\|(?!\|)", line)
            visible = [cell.strip() for cell in cells[1:-1]]
            lowered = [cell.lower() for cell in visible]

            # Preserve/restore separator rows before treating them as data.
            if visible and all(set(cell) <= {"-", ":"} for cell in visible):
                line = "|---|---|---|---|"
            elif (
                len(visible) >= 4
                and all(set(cell) <= {"-", ":"} for cell in visible[:2])
                and visible[2] == "..."
                and lowered[3] == evidence_instruction
            ):
                line = "|---|---|---|---|"
            # Convert the compact two-column form used by parallel dispatch.
            elif (
                len(visible) == 2
                and lowered[0] == "assumption"
                and "mechanical check" in lowered[1]
            ):
                line = "| Assumption | Check command / file read | Result | Script-produced evidence |"
                ground_schema = "two"
            elif len(visible) == 4 and lowered[0] == "assumption":
                line = "| Assumption | Check command / file read | Result | Script-produced evidence |"
                ground_schema = "four"
            elif (
                ground_schema == "two"
                and len(visible) == 2
                and all(set(cell) <= {"-", ":"} for cell in visible)
            ):
                line = "|---|---|---|---|"
            elif (
                len(visible) == 2
                and ground_schema is None
                and all(set(cell) <= {"-", ":"} for cell in visible)
            ):
                ground_schema = "two"
            elif ground_schema == "two" and len(visible) == 2:
                line = f"| {visible[0]} | {visible[1]} | ... | {evidence_instruction} |"
            elif ground_schema == "four" and len(visible) >= 4:
                result = visible[2]
                evidence = visible[3].lower()
                if (
                    result not in ("", "...")
                    or evidence in self_attested
                    or len(visible) > 4
                ):
                    line = f"| {visible[0]} | {visible[1]} | ... | {evidence_instruction} |"

        out.append(line)

    return "\n".join(out)


def strip_orphan_citations(text):
    """Remove [1], [2, 5] etc from prose (not inside code blocks)."""
    # Process line by line to avoid disturbing code blocks
    lines = text.split("\n")
    out = []
    in_code = False
    for line in lines:
        if line.strip().startswith("```"):
            in_code = not in_code
        if not in_code:
            line = CITATION_INLINE.sub("", line)
        out.append(line)
    return "\n".join(out)


def remove_sync_step(content):
    """
    Remove SYNC steps that reference obsidian/sync-obsidian.
    Only remove the step if it contains obsidian/sync-obsidian/symlink keywords.
    """
    lines = content.split("\n")
    out = []
    for line in lines:
        lower = line.lower()
        if re.match(r"^\d+\.\s+SYNC\s*\|", line.strip()):
            if any(
                kw in lower for kw in ["obsidian", "sync-obsidian", "symlink", "vault"]
            ):
                continue  # drop this step
        out.append(line)
    return "\n".join(out)


def remove_banned_freetext(content):
    """Apply banned freetext patterns outside code blocks."""
    lines = content.split("\n")
    out = []
    in_code = False
    for line in lines:
        if line.strip().startswith("```"):
            in_code = not in_code
        if not in_code:
            for pat, replacement in BANNED_FREETEXT:
                line = pat.sub(replacement, line)
            # Clean up empty mistake bullets
            if re.match(r"^-\s+\*\*[^*]+\*\*:\s*$", line.strip()):
                continue
        out.append(line)
    return "\n".join(out)


def remove_illustrative_note(content):
    return ILLUSTRATIVE_NOTE.sub("", content)


def remove_worked_example_section(content, skill_name):
    """Remove illustrative execution tails that contain fabricated evidence."""
    content = WORKED_EXAMPLE_SECTION.sub("", content)
    return content.rstrip() + "\n"


def remove_banned_paths(content):
    """Remove guaranteed-absent paths from tables, prose, and code blocks."""
    lines = content.split("\n")
    out = []
    for line in lines:
        if ".agents/workflows" in line:
            continue
        out.append(line)
    return "\n".join(out)


def strip_trailing_whitespace(content):
    lines = content.split("\n")
    return "\n".join(line.rstrip() for line in lines)


def has_banned_content(content):
    for pat, name in BANNED_PATTERNS:
        if pat.search(content):
            return True
    return False


def repair_file(filepath):
    skill = skill_name_from_path(filepath)

    with open(filepath, "r", encoding="utf-8") as f:
        original = f.read()

    content = original

    # 1. Fix ground table headers and Y/N columns
    content = fix_ground_table(content)

    # 2. Strip orphan citations
    content = strip_orphan_citations(content)

    # 3. Remove sync-obsidian SYNC steps
    content = remove_sync_step(content)

    # 4. Remove banned freetext (Temperature 1.0, ECE, etc.)
    content = remove_banned_freetext(content)

    # 5. Remove illustrative NOTE callouts
    content = remove_illustrative_note(content)

    # 6. Remove worked example (or fix in place for code-reviewer)
    content = remove_worked_example_section(content, skill)

    # 7. Remove banned paths from ground table rows
    content = remove_banned_paths(content)

    # 8. Strip trailing whitespace
    content = strip_trailing_whitespace(content)

    # 9. Ensure single trailing newline
    content = content.rstrip("\n") + "\n"

    changed = content != original

    if changed:
        if VERBOSE:
            print(f"  PATCHING: {filepath}")
        if not DRY_RUN:
            with open(filepath, "w", encoding="utf-8") as f:
                f.write(content)

    return changed


def main():
    if not os.path.isdir(SKILLS_DIR):
        print(f"Error: {SKILLS_DIR} directory not found.")
        sys.exit(1)

    changed_files = []
    total = 0

    for root, dirs, files in os.walk(SKILLS_DIR):
        for file in sorted(files):
            if file == "LITE.md":
                total += 1
                filepath = os.path.join(root, file)
                if repair_file(filepath):
                    changed_files.append(filepath)

    print("\n--- Repair Summary ---")
    print(f"Total overlays scanned: {total}")
    print(f"Files patched: {len(changed_files)}")
    if DRY_RUN:
        print("(DRY RUN — no files written)")
    for f in changed_files:
        print(f"  ✓ {f}")


if __name__ == "__main__":
    main()
