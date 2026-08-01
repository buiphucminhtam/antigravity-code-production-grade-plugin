# SOLVE — The Reasoning Loop

Always follow all steps. If the task is a single trivial edit (e.g., a typo fix), steps 2–3 may collapse to one row/one item — but `VERIFY` (step 6) and `AUDIT` (step 7) are never skipped.

## 1. UNDERSTAND (Write this scratchpad before anything else)
- Task in one sentence:
- What must be TRUE at the end (observable, checkable):
- What could I be wrong about (choose from: wrong file? wrong API shape? wrong version? wrong root cause? missing case?):

## 2. GROUND (Assumption sweep)
Verify essential elements (files, signatures, dependencies, CLI tools) using real check commands.
Do not self-attest Y/N. Mechanical checks must be script-produced evidence that you consume.
| Assumption | Check command / script | Script-produced Evidence |
|---|---|---|
| Target file exists | `ls` / View file | ... |
| Function signature | View file `<file:line>` | ... |
| Dependency/version | View file `package.json` | ... |
| Required CLI tool  | `which <tool>` | ... |

Resolve any failures now or mark the step `HARD`.

## 3. DECOMPOSE
Path branches based on task type:

**A. EDIT PATH (Code modifications)**
Plan least-to-most. EVERY item must have all three fields:
`n. ACTION (one concrete action) | TARGET (exact file/symbol) | CHECK (one command whose exit code proves this item done)`

**B. QUESTION PATH (Codebase queries, non-edit)**
`n. QUESTION | SEARCH COMMAND (e.g., rg "pattern" src/) | SYNTHESIS EXPECTATION`

**C. DESIGN PATH (Architecture/Review, non-edit)**
`n. COMPONENT | ANALYSIS SCRIPT/COMMAND | DESIGN CONSTRAINT`

**D. UI DESIGN GATE (Frontend Edits)**
Before any frontend UI implementation, generate a design contract containing:
- User goal and primary action
- Content hierarchy and layout rationale
- Existing design-system audit
- Tokens: color, typography, spacing, radius, elevation, motion
- Component states: default, hover, focus, disabled, loading, empty, error
- Responsive behavior matrix for narrow, medium, and wide viewports
- Accessibility and reduced-motion requirements
- Wireframe, mockup, or written layout specification
*Note: Major screens/redesigns require user approval. Small UI fixes require an inline design contract but may proceed without blocking.*

**Gate**:
Do not self-attest Y/N claims. Mechanical checks must be script-produced evidence that you consume. Execute your plan's checks to verify:
- Edit plans have concrete actions, verified files, and runnable CHECK commands.
- Total items ≤ 10.
If the script-produced evidence shows failures, fix the list. Do not start execution.

### Parallel Orchestration Decision Contract

Before dispatch, run `scripts/runtime/orchestration_policy.py`: small/serial work
uses `0` workers, mechanical inventory `1` scout, and independent path-disjoint
scopes `2–3` workers. External AGY calls use sandboxed plan mode and reject
writes. Cap by scope, concurrency, and advisory token budget; reserve one slot
for a requested reviewer. Route security, schema, public API, concurrency, or
disagreement to expert. A reviewer sees only requirements, diff, and raw
evidence. No worker may recursively spawn. Stop on duplicate findings, covered
scope, the same blocker twice, budget, or deadline. Fail closed on hard token
caps because AGY has no runtime limiter. Model flags require a structured
same-invocation provider probe; manifests are untrusted. When Codex advertises
GPT-5.6 model overrides, route `expert` to Sol for the hardest problems,
`builder` to Terra for everyday production work, and `scout` to Luna for
high-volume workflows. Use only the exact model ID advertised by the current
Codex runtime; otherwise keep provider-managed selection and omit the override.

## 4. PROGRAM-OF-THOUGHT (PoT) RULE
For any complex logic, calculations, algorithms, or non-trivial implementations:
- Write a quick Program-of-Thought (PoT) scratch script or verification test first.
- Run it to verify the logic and correctness of the assumptions in isolation.
- Use the execution output as ground truth before coding in the main application.

## 5. FREE-FORM THEN JSON RULE
If the task requires JSON or structured output:
- Always think free-form first (write a reasoning block or scratchpad).
- Only output the final clean JSON/structured payload at the very end of the response.

## 6. EXECUTE & VERIFY (One item at a time)
**Note:** Guardrail (Middleware ④) runs `before_tool()` on every tool call during execution. Destructive operations are blocked. See `skills/_shared/protocols/guardrail.md`.

For each plan item:
1. Tag as `EASY` or `HARD` per [ESCALATE.md](ESCALATE.md).
2. If `HARD` → run escalation command.
3. If `EASY` → execute it, then IMMEDIATELY run its CHECK command.
4. **Reasoning checkpoint** (after each CHECK result): Before proceeding, write 1–2 sentences: *What did this result tell me? Does it change my plan?* Do not skip to the next item without this pause.
5. If CHECK fails → resolve the failure before moving to the next item. Never batch items without executing their checks.
6. After finishing all items, emit one `VERIFY` block per changed behavior (see [VERIFY.md](VERIFY.md)).
7. **Adversarial review** (for FEATURE/DEBUG tasks with ≥3 changed files): Spawn a reviewer that sees ONLY the diff + original requirements — not your reasoning context. A fresh perspective catches blind spots.

## 7. AUDIT (Requirement Coverage)
Re-read all changed files in full. Build a requirement coverage matrix, scan for contradictions between rules and examples, and check cross-entry consistency. See [AUDIT.md](AUDIT.md). GAPS FOUND → fix before delivery.

## 8. STUCK RULE (After 2 failures on the same item)
Stop retrying the same approach. A variant of a failed fix is still the same fix. In order:
1. Write a minimal script/test to isolate and test the assumption, then run it.
2. Search the codebase for a working example of the same pattern.
3. Research external documentation or sources.
4. **Reset context**: If accumulated corrections are polluting reasoning, start fresh — restate the goal from scratch with lessons learned, rather than building on failed attempts.
5. If still stuck → mark the item as `HARD` and escalate.
6. If escalation is unavailable → report the blocker along with all gathered evidence. Never attempt a third time on the same fix.

## 9. TURN-CLOSE — Memory Save (MANDATORY, never skip)

After completing all work for this user turn, persist context so the next turn (or next session) can resume without re-deriving:

1. **Save turn summary to mem0** (if `scripts/mem0-v2.py` exists):
   ```
   python3 scripts/mem0-v2.py add "REQ: [1-line user goal] | DONE: [what changed/decided] | OPEN: [blockers or none]" --category session
   ```
   Additionally, if a key decision was made, add a second entry:
   ```
   python3 scripts/mem0-v2.py add "DECISION: [what was decided and why]" --category decisions
   ```

2. **Update conversation summary** — append one line to `.forgewright/subagent-context/CONVERSATION_SUMMARY.md`:
   ```
   | <timestamp> | turn-close | <1-line summary of this exchange> |
   ```

3. **Update activeContext.md** — if current work, scope, or blockers changed, overwrite `.forgewright/memory-bank/activeContext.md` with:
   ```
   # Active Context: [project/feature name]
   ## Current Status
   - [what's done]
   ## Next Steps
   - [what's next]
   ## Open Blockers
   - [blockers or "none"]
   ```

4. **Runtime reclaim** — if this turn started anything long-running, run `bash scripts/runtime/runtime-lease.sh status`, release what you no longer need, and emit VERIFY Template 4. Anything left open must be a deliberate `policy=keep`.

5. **Self-check**: Confirm the mem0 add command succeeded. If it failed, log: `⚠ Memory save failed — context may not persist`.

6. **Self-Report Rule Violation**: Nếu bạn tự nhận ra mình đã quên rule (hoặc user nhắc), bắt buộc chạy rule-ledger.sh:
   ```bash
   bash scripts/lite/rule-ledger.sh add <rule_id> violation "source: self-report|user"
   ```
