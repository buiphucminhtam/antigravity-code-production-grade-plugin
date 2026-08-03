#!/usr/bin/env python3
import os
import re
import sys

# Define color constants for output
RED = "\033[91m"
GREEN = "\033[92m"
YELLOW = "\033[93m"
RESET = "\033[0m"


def log_error(filepath, error_msg):
    print(f"{RED}[FAIL]{RESET} {filepath}: {error_msg}")


def strip_code_blocks(text):
    # Remove multi-line code blocks
    text = re.sub(r"```.*?```", "", text, flags=re.DOTALL)
    # Remove inline code blocks
    text = re.sub(r"`[^`\n]+`", "", text)
    return text


def parse_frontmatter(content, filepath):
    if not content.startswith("---"):
        return None, "File does not start with frontmatter ('---')"
    parts = content.split("---", 2)
    if len(parts) < 3:
        return None, "Malformed frontmatter: missing closing '---'"

    yaml_text = parts[1]
    metadata = {}
    for line in yaml_text.splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        if ":" not in line:
            continue
        key, val = line.split(":", 1)
        key = key.strip()
        val = val.strip().strip("\"'")
        metadata[key] = val

    required_keys = ["name", "description", "version"]
    for k in required_keys:
        if k not in metadata:
            return None, f"Metadata is missing required field: {k}"

    return metadata, None


def validate_table(table_lines, is_ground_table):
    errors = []
    pipe_counts = []
    has_sep = False

    for idx, (line_num, line) in enumerate(table_lines):
        pipe_count = len(re.findall(r"(?<!\\)(?<!\|)\|(?!\|)", line))
        pipe_counts.append((line_num, pipe_count, line))

        if idx == 1:
            sep_content = line.strip("| \t")
            if (
                sep_content
                and all(c in "-:| \t" for c in sep_content)
                and "-" in sep_content
            ):
                has_sep = True

    first_num, first_count, _ = pipe_counts[0]
    for num, count, line in pipe_counts[1:]:
        if count != first_count:
            errors.append(
                f"Table line {num} has {count} columns, mismatching header line {first_num} with {first_count} columns."
            )

    if len(pipe_counts) >= 2 and not has_sep:
        errors.append(
            f"Table starting at line {first_num} is missing a separator row (e.g. '|---|---|')."
        )

    if is_ground_table:
        for idx, (line_num, count, line) in enumerate(pipe_counts):
            cells = [c.strip() for c in re.split(r"(?<!\\)(?<!\|)\|(?!\|)", line)]
            if idx == 0:
                header_text = " | ".join(cells).lower()
                if "script-produced evidence" not in header_text:
                    errors.append(
                        f"Ground table line {line_num} must use 'Script-produced evidence' instead of a self-attested VERIFIED? column."
                    )
                continue
            if idx == 1:
                continue
            if len(cells) >= 6:
                res_cell = cells[
                    3
                ]  # 3rd cell in markdown (| is index 0, so cells[0] is empty if line starts with |)
                evidence_cell = cells[4]  # 4th cell
                if res_cell not in ("...", ""):
                    errors.append(
                        f"Ground table line {line_num} asserts result '{res_cell}' instead of using '...' or empty."
                    )
                if evidence_cell in ("Y", "N", "Y/N", "true", "false", "VERIFIED"):
                    errors.append(
                        f"Ground table line {line_num} has self-attested evidence '{evidence_cell}' instead of script-produced evidence instructions."
                    )

    return errors


def check_tables(content):
    content_stripped = strip_code_blocks(content)
    lines = content_stripped.splitlines()
    in_table = False
    table_lines = []
    errors = []
    is_ground_table = False
    current_section = ""

    for i, line in enumerate(lines):
        line_num = i + 1
        stripped = line.strip()

        if stripped.startswith("#"):
            current_section = stripped.lower()

        if "|" in line and not re.match(r"^\s*(?:\d+\.|\*|-)\s", line):
            if not in_table:
                in_table = True
                table_lines = []
                # Match both canonical slots and worked-example Ground headings.
                is_ground_table = bool(re.search(r"\bground\b", current_section))
            table_lines.append((line_num, line))
        else:
            if in_table:
                if len(table_lines) >= 2:
                    err = validate_table(table_lines, is_ground_table)
                    if err:
                        errors.extend(err)
                in_table = False
                table_lines = []
                is_ground_table = False

    if in_table and len(table_lines) >= 2:
        err = validate_table(table_lines, is_ground_table)
        if err:
            errors.extend(err)

    return errors


def validate_file(filepath):
    errors = []

    # 1. Size check
    try:
        size = os.path.getsize(filepath)
        if size > 8192:
            errors.append(f"File size {size} bytes exceeds the limit of 8192 bytes")
    except Exception as e:
        return [f"Failed to read file size: {e}"]

    try:
        with open(filepath, "r", encoding="utf-8") as f:
            content = f.read()
    except Exception as e:
        return [f"Failed to read file: {e}"]

    # 2. Frontmatter check
    metadata, fm_err = parse_frontmatter(content, filepath)
    if fm_err:
        errors.append(fm_err)

    # 3. Strip code blocks for certain checks
    stripped_text = strip_code_blocks(content)

    # 4. Orphan numeric citations check
    citation_pattern = re.compile(r"\[\d+(?:[\s,-]\d+)*\](?![:\(])")
    citation_matches = citation_pattern.findall(stripped_text)
    if citation_matches:
        errors.append(f"Found orphan numeric citations: {', '.join(citation_matches)}")

    # 5. Nonexistent repo paths check
    path_pattern = re.compile(r"/workspace(?:/\S*)?")
    path_matches = path_pattern.findall(content)
    if path_matches:
        errors.append(
            f"Found nonexistent workspace repo paths: {', '.join(path_matches)}"
        )

    legacy_path_matches = re.findall(r"\.agents/workflows(?:/\S*)?", content)
    if legacy_path_matches:
        errors.append(
            f"Found guaranteed-absent legacy workflow paths: {', '.join(legacy_path_matches)}"
        )

    # 6. Fake success transcripts check
    fake_pattern = re.compile(
        r"\[(?:SUCCESS|INFO|PERF|VRT|ERROR|WARNING|OFFLOAD SUCCESS|OFFLOAD|MOTION|PLAYWRIGHT)\]"
    )
    fake_matches = fake_pattern.findall(content)
    if fake_matches:
        errors.append(
            f"Found fake success transcript identifiers: {', '.join(set(fake_matches))}"
        )

    static_verdict_pattern = re.compile(
        r"^(?:EXIT CODE:\s*0|VERDICT:\s*PASS)\s*$", re.MULTILINE
    )
    static_verdicts = static_verdict_pattern.findall(stripped_text)
    if static_verdicts:
        errors.append(
            "Found static verification verdicts; LITE overlays must instruct the agent to run checks instead of embedding PASS evidence."
        )

    # 7. Malformed tables & ground tables check
    table_errors = check_tables(content)
    if table_errors:
        errors.extend(table_errors)

    return errors


def main():
    skills_dir = "skills"
    if not os.path.isdir(skills_dir):
        print(f"Error: {skills_dir} directory not found.")
        sys.exit(1)

    failed = 0
    total = 0

    for root, dirs, files in os.walk(skills_dir):
        for file in files:
            if file == "LITE.md":
                total += 1
                filepath = os.path.join(root, file)
                errors = validate_file(filepath)
                if errors:
                    failed += 1
                    for err in errors:
                        log_error(filepath, err)

    print("\n--- Validation Summary ---")
    print(f"Total Lite overlays audited: {total}")
    if failed > 0:
        print(f"{RED}Failed: {failed} files with errors.{RESET}")
        sys.exit(1)
    else:
        print(f"{GREEN}All Lite overlays passed validation successfully!{RESET}")
        sys.exit(0)


if __name__ == "__main__":
    main()
