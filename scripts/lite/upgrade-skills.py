#!/usr/bin/env python3
import os
import sys
import json
import re
import argparse
import subprocess
from typing import List

NOTEBOOK_ID = "39238918-b1fb-4c91-8422-4af06d08326a"


def log_info(msg):
    print(f"\033[96m[*] {msg}\033[0m")


def log_success(msg):
    print(f"\033[92m[✓] {msg}\033[0m")


def log_warning(msg):
    print(f"\033[93m[!] {msg}\033[0m")


def log_error(msg):
    print(f"\033[91m[✗] {msg}\033[0m")


def get_remaining_skills(skills_dir: str) -> List[str]:
    """Find all skill directories missing LITE.md"""
    skills = []
    exclude = {"_shared", "_test", "generated"}
    for entry in os.scandir(skills_dir):
        if entry.is_dir() and entry.name not in exclude:
            lite_path = os.path.join(entry.path, "LITE.md")
            if not os.path.exists(lite_path):
                skills.append(entry.name)
    return sorted(skills)


def query_notebooklm(skill_name: str) -> str:
    """Query NotebookLM CLI to research and generate the LITE.md content"""
    prompt = (
        f"You are a Forgewright Skill Distiller. The user is upgrading the '{skill_name}' skill to Forgewright Lite (Stage E3 overlay).\n"
        f"Research the '{skill_name}' skill in the notebook. Distill its core, high-stakes checkpoints and checklists into a minimal 'LITE.md' file under 200 lines.\n"
        f"The output must strictly follow the Forgewright Lite markdown template:\n\n"
        f"---\n"
        f"name: {skill_name}\n"
        f'description: "<brief description of what the skill does>. Use when the user requests <list of triggers/scenarios where this skill should activate>."\n'
        f"version: 1.0.0\n"
        f"---\n\n"
        f"# {skill_name.replace('-', ' ').title()} (LITE)\n\n"
        f"## SOLVE Step 2: GROUND ({skill_name.replace('-', ' ').title()} Domain Slots)\n"
        f"| Assumption | Check command / file read | Result | VERIFIED? |\n"
        f"|---|---|---|---|\n"
        f"<2-4 core domain-specific grounding checks for this skill>\n\n"
        f"## SOLVE Step 3: DECOMPOSE ({skill_name.replace('-', ' ').title()} Domain Slots)\n"
        f"Format: `n. ACTION | TARGET | CHECK`\n"
        f"<2-4 example step templates showing typical action/target/check for this skill domain>\n\n"
        f"## Common Mistakes Checklist\n"
        f"<3-5 domain-specific common mistakes or security/concurrency/performance checklist items to verify>\n\n"
        f"## Worked Example\n"
        f"<A short, concrete worked example showing typical command execution and output for this skill>\n\n"
        f"Ensure the output is clean Markdown starting with the '---' block. Do not add any conversational text or commentary outside the markdown."
    )

    cmd = ["nlm", "notebook", "query", NOTEBOOK_ID, prompt]
    log_info(f"Running NotebookLM query for skill '{skill_name}'...")

    res = subprocess.run(cmd, capture_output=True, text=True)
    if res.returncode != 0:
        log_error(f"NotebookLM CLI command failed: {res.stderr}")
        return ""

    return res.stdout.strip()


def parse_markdown(raw_output: str) -> str:
    """Clean and extract only the markdown block from raw output"""
    content = raw_output
    # Try parsing as JSON first (handles when nlm returns JSON structured output)
    try:
        data = json.loads(raw_output)
        if isinstance(data, dict):
            if (
                "value" in data
                and isinstance(data["value"], dict)
                and "answer" in data["value"]
            ):
                content = data["value"]["answer"]
            elif "answer" in data:
                content = data["answer"]
    except Exception:
        pass  # Not a valid JSON, use raw text

    # Find the frontmatter --- block
    match = re.search(r"---[\s\S]+?---[\s\S]+", content)
    if match:
        return match.group(0).strip()
    return content


def update_index(skills_dir: str, index_path: str):
    """Regenerate kernel/INDEX.md dynamically by scanning all LITE.md files"""
    log_info("Regenerating Skill Index (kernel/INDEX.md)...")

    skills_data = []
    exclude = {"_shared", "_test", "generated"}

    for entry in sorted(os.scandir(skills_dir), key=lambda e: e.name):
        if entry.is_dir() and entry.name not in exclude:
            lite_path = os.path.join(entry.path, "LITE.md")
            if os.path.exists(lite_path):
                # Read frontmatter to get description and triggers
                try:
                    with open(lite_path, "r") as f:
                        content = f.read()

                    fm_match = re.match(r"^---\s*\n(.*?)\n---\s*\n", content, re.DOTALL)
                    if fm_match:
                        fm_text = fm_match.group(1)
                        name_match = re.search(r"^name:\s*(.+)$", fm_text, re.MULTILINE)
                        desc_match = re.search(
                            r"^description:\s*[\"']?(.+?)[\"']?$", fm_text, re.MULTILINE
                        )

                        name = name_match.group(1).strip() if name_match else entry.name
                        desc = desc_match.group(1).strip() if desc_match else ""

                        # Extract triggers (everything after "Use when...")
                        triggers = desc
                        if "Use when" in desc:
                            triggers = desc.split("Use when", 1)[1].strip()
                            triggers = (
                                triggers.lstrip("the user requests")
                                .lstrip("the user reports")
                                .lstrip(" ")
                                .strip(".")
                            )
                            triggers = triggers[0].upper() + triggers[1:]

                        rel_path = f"skills/{entry.name}/LITE.md"
                        skills_data.append(
                            {"name": name, "triggers": triggers, "path": rel_path}
                        )
                except Exception as e:
                    log_warning(f"Failed to parse LITE.md in {entry.name}: {e}")

    # Write INDEX.md
    lines = [
        "# Skill Index\n",
        "This index maps skill names to their triggers and the file path of their respective LITE.md overlays. During the boot sequence, load at most one skill overlay matching the task class.\n",
        "| Skill Name | Triggers | Trigger File |\n",
        "|---|---|---|\n",
    ]

    for skill in skills_data:
        lines.append(
            f"| **{skill['name']}** | {skill['triggers']} | [{skill['path']}](../{skill['path']}) |\n"
        )

    with open(index_path, "w") as f:
        f.writelines(lines)

    log_success(
        f"Skill Index regenerated at {index_path} ({len(skills_data)} skills mapped)"
    )


def main():
    parser = argparse.ArgumentParser(description="Forgewright Lite Skill Upgrader")
    parser.add_argument(
        "--limit",
        type=int,
        default=5,
        help="Maximum number of skills to process in this run",
    )
    parser.add_argument(
        "--skill", type=str, help="Process a single specific skill only"
    )
    args = parser.parse_args()

    script_dir = os.path.dirname(os.path.abspath(__file__))
    repo_root = os.path.abspath(os.path.join(script_dir, "..", ".."))
    skills_dir = os.path.join(repo_root, "skills")
    index_path = os.path.join(repo_root, "kernel", "INDEX.md")

    # 1. Single skill mode
    if args.skill:
        remaining = [args.skill]
    else:
        # Get list of remaining skills
        remaining = get_remaining_skills(skills_dir)
        log_info(f"Total skills remaining to upgrade: {len(remaining)}")
        if not remaining:
            log_success("All skills upgraded! Regenerating index just in case...")
            update_index(skills_dir, index_path)
            sys.exit(0)

        remaining = remaining[: args.limit]

    log_info(f"Upgrading skills batch: {remaining}")

    processed_count = 0
    for skill in remaining:
        log_info(
            f"--- Upgrading skill '{skill}' ({processed_count + 1}/{len(remaining)}) ---"
        )
        raw_markdown = query_notebooklm(skill)
        if not raw_markdown:
            log_error(
                f"Failed to get output for skill '{skill}' from NotebookLM. Skipping."
            )
            continue

        clean_markdown = parse_markdown(raw_markdown)
        skill_path = os.path.join(skills_dir, skill)
        os.makedirs(skill_path, exist_ok=True)
        lite_path = os.path.join(skill_path, "LITE.md")

        with open(lite_path, "w") as f:
            f.write(clean_markdown + "\n")

        log_success(f"Successfully wrote LITE.md for '{skill}'")
        processed_count += 1

    # 2. Update Skill Index and Sync Kernel
    if processed_count > 0 or not args.skill:
        update_index(skills_dir, index_path)

        # Run sync-kernel script
        sync_script = os.path.join(script_dir, "sync-kernel.sh")
        if os.path.exists(sync_script):
            log_info("Running kernel synchronization...")
            subprocess.run(["bash", sync_script])
            log_success("Kernel synchronization complete")

    log_success(f"Batch completed. Processed {processed_count} skills.")


if __name__ == "__main__":
    main()
