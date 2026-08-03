import os
import tempfile
import importlib.util

# Load validate-overlays.py dynamically due to hyphen in filename
script_path = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "../../scripts/lite/validate-overlays.py")
)
spec = importlib.util.spec_from_file_location("validate_overlays", script_path)
validate_overlays = importlib.util.module_from_spec(spec)
spec.loader.exec_module(validate_overlays)

repair_script_path = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "../../scripts/lite/repair-overlays.py")
)
repair_spec = importlib.util.spec_from_file_location(
    "repair_overlays", repair_script_path
)
repair_overlays = importlib.util.module_from_spec(repair_spec)
repair_spec.loader.exec_module(repair_overlays)

validate_file = validate_overlays.validate_file
validate_table = validate_overlays.validate_table
check_tables = validate_overlays.check_tables
parse_frontmatter = validate_overlays.parse_frontmatter
fix_ground_table = repair_overlays.fix_ground_table
remove_worked_example_section = repair_overlays.remove_worked_example_section
remove_banned_paths = repair_overlays.remove_banned_paths


def test_parse_frontmatter():
    valid_fm = """---
name: test-skill
description: "A test skill description"
version: 1.0.0
---
Body content"""
    metadata, err = parse_frontmatter(valid_fm, "test.md")
    assert err is None
    assert metadata["name"] == "test-skill"
    assert metadata["description"] == "A test skill description"
    assert metadata["version"] == "1.0.0"

    invalid_fm = """---
name: test-skill
---
Body content"""
    metadata, err = parse_frontmatter(invalid_fm, "test.md")
    assert err is not None
    assert "missing required field" in err


def test_validate_table():
    # Well-formed table
    table = [(1, "| Header 1 | Header 2 |"), (2, "|---|---|"), (3, "| Row 1 | Row 2 |")]
    errors = validate_table(table, is_ground_table=False)
    assert len(errors) == 0

    # Mismatched columns
    bad_table = [
        (1, "| Header 1 | Header 2 |"),
        (2, "|---|---|"),
        (3, "| Row 1 | Row 2 | Row 3 |"),
    ]
    errors = validate_table(bad_table, is_ground_table=False)
    assert len(errors) > 0
    assert "mismatching header" in errors[0]

    # Missing separator
    missing_sep = [(1, "| Header 1 | Header 2 |"), (2, "| Row 1 | Row 2 |")]
    errors = validate_table(missing_sep, is_ground_table=False)
    assert len(errors) > 0
    assert "missing a separator row" in errors[0]


def test_ground_table_assertions():
    # Valid ground table
    good_ground = [
        (
            1,
            "| Assumption | Check command / file read | Result | Script-produced evidence |",
        ),
        (2, "|---|---|---|---|"),
        (
            3,
            "| File exists | ls file.txt | ... | run the check command and paste output |",
        ),
        (4, "| Config exists | cat config.json | | |"),
    ]
    errors = validate_table(good_ground, is_ground_table=True)
    assert len(errors) == 0

    # Invalid ground table asserting results
    bad_ground = [
        (
            1,
            "| Assumption | Check command / file read | Result | Script-produced evidence |",
        ),
        (2, "|---|---|---|---|"),
        (3, "| File exists | ls file.txt | Exists | Y |"),
    ]
    errors = validate_table(bad_ground, is_ground_table=True)
    assert len(errors) == 2
    assert "asserts result" in errors[0]
    assert "self-attested evidence" in errors[1]


def test_ground_table_heading_detection_covers_worked_examples():
    worked_example_ground = [
        (
            1,
            "| Assumption | Check command / file read | Result | Script-produced evidence |",
        ),
        (2, "|---|---|---|---|"),
        (
            3,
            "| Target exists | ls target | ... | run the check command and paste output |",
        ),
    ]
    assert (
        validate_overlays.check_tables(
            "### 2. GROUND\n" + "\n".join(line for _, line in worked_example_ground)
        )
        == []
    )


def test_ground_table_repair_is_idempotent():
    content = """## SOLVE Step 2: GROUND
| Assumption | Check command / file read | Result | Script-produced evidence |
|---|---|---|---|
| File exists | ls file.txt | ... | run the check command and paste output |
"""
    repaired = fix_ground_table(content)
    assert repaired == content
    assert fix_ground_table(repaired) == repaired


def test_ground_table_repair_normalizes_compact_and_self_attested_rows():
    compact = """## SOLVE Step 2: GROUND
| Assumption | Mechanical check |
|---|---|
| Manifest is valid | python3 -m json.tool manifest.json |
"""
    repaired_compact = fix_ground_table(compact)
    assert "|---|---|---|---|" in repaired_compact
    assert (
        "| Manifest is valid | python3 -m json.tool manifest.json | ... | run the check command and paste output |"
        in repaired_compact
    )

    worked_example = """### 2. GROUND
| Assumption | Check command | Result | VERIFIED? |
|---|---|---|---|
| File exists | ls file.txt | File exists | Y |
"""
    repaired_example = fix_ground_table(worked_example)
    assert "VERIFIED?" not in repaired_example
    assert (
        "| File exists | ls file.txt | ... | run the check command and paste output |"
        in repaired_example
    )


def test_repair_removes_illustrative_execution_tail():
    content = """## SOLVE Step 3: DECOMPOSE
1. ACTION | TARGET | CHECK

---

### 1. UNDERSTAND
Illustrative task.

### 5. VERIFY
EXIT CODE: 0
VERDICT: PASS
"""
    assert remove_worked_example_section(content, "example") == (
        "## SOLVE Step 3: DECOMPOSE\n1. ACTION | TARGET | CHECK\n"
    )


def test_repair_and_validator_reject_legacy_workflow_paths():
    content = """```text
.agents/workflows/design_dna.json
```
"""
    assert ".agents/workflows" not in remove_banned_paths(content)

    with tempfile.NamedTemporaryFile(suffix=".md", mode="w", delete=False) as f:
        f.write("""---
name: temp-skill
description: "A temporary skill"
version: 1.0.0
---
.agents/workflows/design_dna.json
""")
        temp_name = f.name

    try:
        errors = validate_file(temp_name)
        assert "legacy workflow paths" in "".join(errors)
    finally:
        os.remove(temp_name)


def test_validate_file_constraints():
    with tempfile.NamedTemporaryFile(suffix=".md", mode="w", delete=False) as f:
        f.write("""---
name: temp-skill
description: "A temporary skill"
version: 1.0.0
---
## SOLVE Step 2: GROUND
| Assumption | Check command | Result | Script-produced evidence |
|---|---|---|---|
| File exists | ls | ... | run the check command and paste output |

## Worked Example
> [!NOTE]
> The following example is illustrative.
""")
        temp_name = f.name

    try:
        errors = validate_file(temp_name)
        assert len(errors) == 0
    finally:
        os.remove(temp_name)


def test_validate_file_with_orphan_citations():
    with tempfile.NamedTemporaryFile(suffix=".md", mode="w", delete=False) as f:
        f.write("""---
name: temp-skill
description: "A temporary skill [1]"
version: 1.0.0
---
Body text [2]
""")
        temp_name = f.name

    try:
        errors = validate_file(temp_name)
        assert len(errors) > 0
        assert "orphan numeric citations" in "".join(errors)
    finally:
        os.remove(temp_name)


def test_validate_file_with_fake_transcripts():
    with tempfile.NamedTemporaryFile(suffix=".md", mode="w", delete=False) as f:
        f.write("""---
name: temp-skill
description: "A temporary skill"
version: 1.0.0
---
Output:
[SUCCESS] Operation completed.
""")
        temp_name = f.name

    try:
        errors = validate_file(temp_name)
        assert len(errors) > 0
        assert "fake success transcript" in "".join(errors)
    finally:
        os.remove(temp_name)


def test_validate_file_rejects_static_pass_verdicts():
    with tempfile.NamedTemporaryFile(suffix=".md", mode="w", delete=False) as f:
        f.write("""---
name: temp-skill
description: "A temporary skill"
version: 1.0.0
---
EXIT CODE: 0
VERDICT: PASS
""")
        temp_name = f.name

    try:
        errors = validate_file(temp_name)
        assert "static verification verdicts" in "".join(errors)
    finally:
        os.remove(temp_name)
