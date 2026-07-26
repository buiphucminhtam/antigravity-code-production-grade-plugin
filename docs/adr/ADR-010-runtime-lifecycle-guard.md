# ADR 010: Runtime Lifecycle Guard (RLG)

- Status: **TOÀN BỘ P0 → P4 Accepted, implemented & ĐANG CHẠY** (`MODE=enforce`) trên Claude / Codex / Antigravity
- Date: 2026-07-26
- Scope: GLOBAL (mọi project trên máy)

## Bối cảnh

**Status:** P0 + P0.5 **ĐÃ IMPLEMENT & CÀI ĐẶT** (2026-07-26) · P1–P4 còn là proposal
**Chế độ hiện tại:** `observe` — chưa gắn hook nào vào `~/.claude/settings.json`, chưa có gì bị kill.
**Ngày:** 2026-07-26
**Phạm vi:** **GLOBAL** — áp dụng cho mọi project trên máy (chốt bởi user 2026-07-26), không chỉ repo forgewright.
**Vấn đề:** Project game/web bị spam mở app & port, quên đóng → RAM phình, disk phình.

---

## 1. Root cause (phân loại lỗi, không phải triệu chứng)

| # | Nguyên nhân | Hệ quả |
|---|---|---|
| R1 | Agent/dev spawn dev-server mà **không kiểm tra instance đang chạy** | N bản `vite`/`next dev`/`godot`/`Unity` trùng nhau |
| R2 | Port **cấp phát ngẫu nhiên / tự tăng** (3000 → 3001 → 3002…) | Mỗi lần fail là 1 port mới bị chiếm, không ai thu hồi |
| R3 | Process spawn **không có owner, không có PGID riêng** | Không biết của session nào → không dám kill → để mãi |
| R4 | **Không có bước reclaim khi kết thúc turn/session** | Process sống qua nhiều session, tích lũy |
| R5 | Log/artifact/build cache **không có TTL và size cap** | `.next`, `dist`, `Library/`, `playwright-report`, `.forgewright/verify/*.json` phình vô hạn |
| R6 | Không có **evidence bắt buộc** về runtime trong VERIFY | Không ai phát hiện leak tại thời điểm gây ra |

Nguyên tắc thiết kế: **fix R1–R4 ở lớp spawn (phòng), fix R5 ở lớp housekeeping (chữa), fix R6 ở lớp gate (bắt).**

### Baseline đo được lúc viết plan (máy hiện tại)

```
listening sockets: 15
dev-band ports:    5000 (ControlCenter), 8085 (Python), 5432 (postgres), 3040 (aurora)
orphan dev-server: 0 tại thời điểm đo
```

→ Máy đang sạch, nên đây là bài toán **phòng ngừa + đo liên tục**, không phải cứu hoả. Cần P0 (đo) trước khi enforce.

---

## 2. Kiến trúc đề xuất

```
                    ┌──────────────────────────────────┐
  Bash tool call →  │ PreToolUse: runtime-pretool-gate │  R1,R2: chặn spawn trùng
                    └───────────────┬──────────────────┘
                                    ↓ (rewrite sang wrapper)
                    ┌──────────────────────────────────┐
                    │ scripts/runtime/dev-run.sh       │  R2,R3: port broker + setsid + lease
                    └───────────────┬──────────────────┘
                                    ↓ ghi
                    ┌──────────────────────────────────┐
                    │ .forgewright/runtime/leases.jsonl│  ← nguồn sự thật duy nhất
                    └───────────────┬──────────────────┘
        ┌───────────────────────────┼───────────────────────────┐
        ↓                           ↓                           ↓
  Stop / SessionEnd          verify-gate (VERIFY)         cron / preflight
  runtime-reap.sh            RUNTIME LEDGER block         disk-budget.sh
  R4: thu hồi                R6: chặn nếu leak            R5: TTL + size cap
```

**Bất biến (invariant):** *Mọi process sống lâu do agent tạo ra đều phải có 1 lease. Reaper chỉ được kill PID có trong registry.* Không bao giờ `pkill -f node` — đó là vi phạm Hard Rule 6 (guardrail).

---

## 2.5 Phạm vi GLOBAL — các ràng buộc bắt buộc

Chốt global làm thay đổi 8 điểm so với bản repo-only. Đây là phần quan trọng nhất của plan.

### G1 — State nằm ở home, không nằm trong repo

Lease xuyên project ⇒ nguồn sự thật phải là **`~/.forgewright/runtime/`**:

```
~/.forgewright/runtime/
  leases.jsonl          # registry duy nhất, toàn máy
  projects.index        # project_root → port band (ổn định vĩnh viễn)
  port-allowlist.txt    # port hạ tầng cấm đụng
  logs/<lease_id>.log   # log có size cap
  DISABLED              # tồn tại = tắt toàn bộ RLG (kill-switch)
```

`.forgewright/runtime/` trong từng repo **không dùng** (chỉ chứa file opt-out nếu cần).

### G2 — Cài bằng symlink, tuyệt đối không copy

**Bằng chứng đo được:** `~/.forgewright/scripts/` hiện là bản **copy**, và đã drift:

```
global: ~/.forgewright/scripts/cleanup.sh          May 18 11:56  7280B
repo:   scripts/utilities/cleanup.sh              Jul  9 16:05  7283B   >>> DRIFTED
```

Nếu RLG cài theo cùng cách, **reaper chạy ở hook global sẽ là code cũ** — một script có quyền kill process mà không khớp source trong repo là không chấp nhận được.

⇒ `scripts/runtime/runtime-install.sh --link`:
- tạo symlink `~/.forgewright/scripts/runtime/*` → `<repo>/scripts/runtime/*`
- ghi `~/.forgewright/runtime/INSTALLED_FROM` (đường dẫn repo + git SHA)
- `--verify` so sánh SHA hiện tại, cảnh báo nếu repo đã đổi mà chưa reload
- **fail-closed riêng ở đây**: nếu symlink hỏng/trỏ sai → hook tự vô hiệu hoá, không chạy code lạ.

### G3 — Hook cài ở `~/.claude/settings.json`

Đã có sẵn: `PreToolUse: Grep|Glob|Bash` (gitnexus), `PostToolUse` (gitnexus + memory checkpoint), `UserPromptSubmit`, `Stop` ×2 (verify-gate, stop-gate). Thêm 2 entry:

| Sự kiện | Lệnh | Timeout |
|---|---|---|
| `PreToolUse: Bash` | `runtime-pretool-gate.sh` (nối **sau** gitnexus) | 5s |
| `SessionEnd` | `runtime-reap.sh --session $SESSION_ID &` | 5s |

Sửa settings qua skill `update-config`, không sửa tay. Không đụng vào `Stop` để tránh xung đột với verify-gate/stop-gate đang chạy.

### G4 — Blast radius: hook chạy ở MỌI project trên máy

Kể cả repo không phải forgewright, kể cả lệnh không liên quan. Ràng buộc cứng:

1. **Fail-open tuyệt đối** — mọi lỗi nội bộ ⇒ `exit 0`, không bao giờ chặn công việc.
2. **Ngân sách < 100ms** (chặt hơn bản repo-only): chỉ regex trên chuỗi lệnh + đọc 1 file index. Không gọi `lsof`/`git` trong đường nóng của gate.
3. **Kill-switch 3 tầng**: env `FORGEWRIGHT_RLG=off` → file `~/.forgewright/runtime/DISABLED` → opt-out từng project bằng `.forgewright/rlg-optout`.
4. **Chế độ mặc định khi mới cài = `observe`**, không phải `enforce`.

### G5 — Không dựa vào registry global hiện có

`~/.forgewright/config/registry.json` **không tồn tại** (thư mục `config/` rỗng) dù `fw-global-registry.sh` có tham chiếu tới. ⇒ RLG tự duy trì `projects.index`, ghi lần đầu khi thấy một project root mới. Không sửa/bootstrap registry.json (ngoài phạm vi).

### G6 — Ownership theo session, không theo cwd

Một session Claude có thể `cd` sang project khác giữa chừng. Reaper scope theo `session_id` trong lease; `project` chỉ là metadata để cấp port band và tính quota.

### G7 — Allowlist là hạ tầng toàn máy

Rộng hơn nhiều so với repo-only. Seed ban đầu từ máy hiện tại: `5432 postgres`, `5000 ControlCenter`, `3040 aurora`, `8085 Python`. Nguyên tắc: **mọi PID không do RLG spawn đều mặc định bất khả xâm phạm**, allowlist chỉ là lớp phòng thủ thứ hai.

### G8 — P2 lên rủi ro CAO

Reclaim ở phạm vi global có thể chạm process của bất kỳ project nào. Bắt buộc `--dry-run` tối thiểu 1 tuần (thay vì 3 ngày) và phải review log reap trước khi bật enforce.

---

## 3. Thành phần & file cần tạo

> Đường dẫn dưới đây là **source trong repo**; bản chạy thật là symlink tại `~/.forgewright/scripts/runtime/` (xem G2).

### 3.1 Lease registry — `scripts/runtime/runtime-lease.sh`

State: `~/.forgewright/runtime/leases.jsonl` (append-only, mỗi dòng 1 record)

```json
{
  "lease_id": "01f0-…",
  "project": "/Users/…/jigsawsolite",
  "session_id": "6b86dc8f-…",
  "role": "web-dev|game-editor|emulator|test-runner|docker",
  "pid": 15167, "pgid": 15167,
  "port": 3040,
  "cmd": "npm run dev",
  "log": ".forgewright/runtime/logs/01f0-….log",
  "started_at": "2026-07-26T10:00:00Z",
  "ttl_sec": 7200,
  "policy": "reap|keep",
  "state": "open|closed|orphan"
}
```

Sub-commands: `acquire | release | list | status | reap | prune | adopt`.

### 3.2 Port broker — `scripts/runtime/port-broker.sh`

- Port band **tất định theo project**: `base = 20000 + (crc32(project_path) % 400) * 10`, mỗi project 10 port cho 10 role. Hết random drift.
- `alloc <project> <role>` → nếu port đã LISTEN **và** lease còn sống với cùng cmd → trả `REUSE` + PID (không spawn mới). Đây là fix trực tiếp cho "spam mở app".
- Allowlist port hạ tầng không đụng tới: `5432 postgres`, `5000 ControlCenter`, `3040 aurora`, `8085` → file `~/.forgewright/runtime/port-allowlist.txt` (xem G7).
- Band lưu vĩnh viễn trong `~/.forgewright/runtime/projects.index` để một project luôn nhận cùng dải port qua mọi session.

### 3.3 Wrapper — `scripts/runtime/dev-run.sh`

Cách duy nhất được phép khởi động thứ gì chạy lâu:

```bash
bash scripts/runtime/dev-run.sh --role web-dev --ttl 2h -- npm run dev
```

Làm: alloc port → `setsid` (process group riêng, kill sạch cả cây con) → log ra `~/.forgewright/runtime/logs/<lease_id>.log` **có size cap 10MB + rotate 3** → health-probe port tới khi ready hoặc timeout → in JSON `{lease_id, port, pid, url}` → ghi lease.

### 3.4 Pre-spawn gate — `scripts/lite/runtime-pretool-gate.sh` (hook `PreToolUse: Bash`)

Nhận diện pattern: `npm|pnpm|yarn run dev`, `vite`, `next dev`, `webpack serve`, `http.server`, `serve `, `docker compose up`, `godot --editor`, `Unity -projectPath`, `emulator -avd`, `playwright test --headed`, và **mọi lệnh kết thúc bằng `&`**.

Quyết định:
- `DENY` — đã có lease sống cùng project+role → trả về port cũ, bảo agent dùng lại.
- `DENY` — vượt quota (mặc định 2 dev-server/project, 6 toàn máy).
- `WARN → rewrite` — chạy raw thay vì qua `dev-run.sh`.
- `ALLOW` — mọi thứ khác. **Fail-open** (hook lỗi ⇒ không chặn công việc).

### 3.5 Reclaim — `scripts/runtime/runtime-reap.sh` (hook `Stop` + `SessionEnd`)

Chính sách thu hồi:
1. Lease của session vừa kết thúc & `policy=reap` → `TERM` PGID → chờ 5s → `KILL`.
2. Lease quá `ttl_sec` → reap bất kể session.
3. Lease có PID đã chết → `prune` (chỉ dọn record).
4. Port trong band nhưng **không có lease** → chỉ báo cáo `orphan`, cần `--force` mới kill (tránh giết nhầm process người dùng tự mở).

Chạy **nền, không chặn** (hook Claude Code timeout 10s) — bắn `runtime-reap.sh &` rồi thoát 0.

### 3.6 Disk budget — `scripts/runtime/disk-budget.sh` + mở rộng `scripts/utilities/cleanup.sh --runtime`

Đo & áp ngưỡng cho: `node_modules`, `.next`, `dist`, `build`, `Library/` (Unity), `.godot`, `.import`, `playwright-report`, `test-results`, `.forgewright/runtime/logs`, `.forgewright/verify`, `.forgewright/reports`.

Ngưỡng khai báo trong `~/.forgewright/runtime/budget.yaml` (global default), cho phép từng project override bằng `.forgewright/budget.yaml` — file này đã tồn tại trong repo forgewright với block `budget:` cho token, RLG thêm block riêng nên không xung đột:

```yaml
runtime:
  max_dev_servers_per_project: 2
  max_dev_servers_global: 6
  default_ttl_sec: 7200
  log_max_mb: 10
disk:
  artifact_ttl_days: 7        # .forgewright/verify, reports, logs
  warn_project_gb: 5
  block_project_gb: 15
```

### 3.7 Evidence — thêm VERIFY Template 4 (`kernel/VERIFY.md`)

```text
RUNTIME LEDGER
OPENED:  <lease_id> role=<..> port=<..> pid=<..>
CLOSED:  <lease_id> exit=<..>
LEAKED:  none | <lease_id list>
COMMAND: bash scripts/runtime/runtime-lease.sh status --session $SESSION_ID
OUTPUT:  <paste>
VERDICT: CLEAN | LEAKED
```

`scripts/lite/verify-gate.sh` chặn Stop nếu `LEAKED != none` mà agent không khai báo `policy=keep`.

### 3.8 Kernel & skill overlay

- `kernel/SOLVE.md` §9 TURN-CLOSE: thêm bước **"Runtime reclaim"** trước bước save memory.
- `kernel/ESCALATE.md`: thêm signal HARD — "reaper phải kill PID ngoài registry".
- Overlay cho skill hay spawn: `skills/devops`, `skills/qa-engineer`, `skills/frontend-engineer`, `skills/game-engineer`, `skills/godot-engineer`, `skills/unity-engineer`, `skills/phaser3-engineer`, `skills/mobile-engineer` → 1 dòng: *"Mọi lệnh chạy lâu phải qua `dev-run.sh`."*
- Chạy `python3 scripts/lite/sync-kernel.py` để regenerate `CLAUDE.md` (không sửa tay).

### 3.9 CI & telemetry

- `scripts/ci/verify-runtime-leases.sh` → thêm vào `scripts/ci/run-required-checks.sh`: fail nếu commit có lease `state=open` bị commit nhầm, hoặc script wrapper mất quyền exec.
- `scripts/ci/pipeline-preflight.sh`: kiểm tra port band trống trước khi chạy test → giảm flaky "EADDRINUSE".
- Mỗi lần reap thấy leak → `bash scripts/lite/rule-ledger.sh add RLG-01 violation "leaked lease"` để vòng self-healing học được.

---

## 4. Lộ trình (5 phase, ship dần, mỗi phase độc lập có giá trị)

| Phase | Nội dung | File | Effort | Rủi ro |
|---|---|---|---|---|
| **P0 — OBSERVE** | `runtime-lease.sh` (list/status/adopt) + `runtime-inventory` báo cáo port/RAM/disk toàn máy. Chưa kill, chưa hook. | 3.1 | ~0.5 ngày | Rất thấp |
| **P0.5 — INSTALL** | `runtime-install.sh --link/--verify` (symlink, chống drift G2) + kill-switch 3 tầng + seed allowlist/projects.index | G1, G2, G4 | ~0.5 ngày | Thấp |
| **P1 — SPAWN** | `port-broker.sh` + `dev-run.sh` + gate `PreToolUse` ở chế độ **observe/WARN-only** trên `~/.claude/settings.json` | 3.2–3.4, G3 | ~1.5 ngày | Thấp |
| **P2 — RECLAIM** | `runtime-reap.sh` gắn `SessionEnd`, `--dry-run` **≥1 tuần** rồi mới enforce; gate chuyển DENY | 3.5, G6, G8 | ~1 ngày | **CAO** — chạm process của mọi project |
| **P3 — DISK** | `disk-budget.sh` + `cleanup.sh --runtime` + TTL artifact | 3.6 | ~1 ngày | Thấp (mặc định dry-run) |
| **P4 — GATE** | VERIFY Template 4, kernel/skill overlay, CI check, rule-ledger | 3.7–3.9 | ~1 ngày | Thấp |

Gate giữa các phase:
- P1 chỉ bật khi P0.5 `--verify` xanh (symlink đúng, kill-switch hoạt động).
- P2 chỉ bật enforce khi P0/P1 chạy **≥1 tuần** ở chế độ observe và log cho thấy 0 false-positive trên allowlist.

---

## 5. Rủi ro & biện pháp

| Rủi ro | Biện pháp |
|---|---|
| Kill nhầm postgres/ControlCenter/aurora của user | Chỉ kill PID có lease; allowlist port hạ tầng; orphan cần `--force` |
| Hook làm chậm mọi lệnh Bash | Gate phải < 150ms: chỉ regex trên chuỗi lệnh + đọc 1 file; reaper chạy nền |
| Hook lỗi làm kẹt workflow | Fail-open toàn bộ (exit 0 khi có lỗi nội bộ); chỉ verify-gate mới được block |
| macOS vs Linux khác `lsof`/`pgrep` | Wrap trong `runtime-lease.sh` với fallback `ss`/`netstat`; test cả 2 trong `run-self-tests.sh` |
| Registry hỏng / đua ghi | `leases.jsonl` append-only + `flock`; `prune` tự phục hồi từ trạng thái thật của OS |
| Agent lách bằng cách gọi trực tiếp | Gate bắt cả pattern `&`; và VERIFY ledger bắt hậu kiểm |
| **[G]** Script global drift khỏi repo → reaper chạy code cũ | Symlink + `INSTALLED_FROM` + `--verify`; symlink hỏng ⇒ hook tự tắt (G2) |
| **[G]** Hook ảnh hưởng project không liên quan trên máy | Kill-switch 3 tầng, opt-out per-project, mặc định `observe` (G4) |
| **[G]** Gate làm chậm mọi lệnh Bash ở mọi repo | Ngân sách <100ms, cấm gọi `lsof`/`git` trong đường nóng (G4) |
| **[G]** Xung đột với hook gitnexus/memory đang chạy sẵn | Nối sau gitnexus trong cùng matcher; không đụng `Stop` (G3) |
| **[G]** Reaper giết process của project khác cùng lúc | Scope theo `session_id`, không theo cwd (G6) |

---

## 6. Định nghĩa Hoàn thành (đo được)

1. Chạy `npm run dev` 5 lần liên tiếp → chỉ 1 process, 4 lần trả `REUSE`.
2. Kết thúc session → `runtime-lease.sh status` trả `open: 0` (trừ lease `policy=keep`).
3. Sau 7 ngày, số listening port dev-band ổn định, không tăng đơn điệu.
4. `disk-budget.sh` báo mọi project dưới `warn_project_gb`.
5. `run-required-checks.sh` xanh với check mới.
6. **[G]** `runtime-install.sh --verify` xanh; sửa 1 script trong repo → `--verify` phát hiện ngay (chống drift).
7. **[G]** `touch ~/.forgewright/runtime/DISABLED` → mọi hook trở thành no-op, đo được bằng lệnh Bash bất kỳ.
8. **[G]** Overhead gate đo bằng `time` trên 100 lệnh Bash: p95 < 100ms.
9. **[G]** Reaper chạy ở project A không đụng lease của project B trong cùng thời điểm.

---

## 6.5 Nhật ký triển khai P0 + P0.5 (2026-07-26)

### File đã tạo

| File | Vai trò |
|---|---|
| `scripts/runtime/runtime-common.sh` | Helper pure-bash: paths, kill-switch 3 tầng, lock (mkdir, không dùng `flock` vì macOS thiếu), port band, allowlist |
| `scripts/runtime/runtime_registry.py` | Engine JSONL append-only; fold event → state; **không bao giờ gửi tín hiệu cho process** |
| `scripts/runtime/runtime-lease.sh` | CLI: `acquire/adopt/release/list/status/prune/band/port` |
| `scripts/runtime/runtime-inventory.sh` | Báo cáo read-only: ports / dev processes / disk |
| `scripts/runtime/runtime-install.sh` | `--link/--verify/--status/--uninstall` (fail-closed) |
| `tests/runtime/test_runtime_p0.sh` | 39 assertion, sandbox cô lập |

Kết quả: shellcheck clean · py_compile ok · **39/39 test pass** · `--verify` PASS trên máy thật · 0 process rò rỉ.

### 5 bug bị test/thực địa bắt được (đáng ghi lại)

1. **`--verify` pass rỗng.** Bộ trích manifest dùng f-string có `\"` → `SyntaxError` trên Python 3.14; đặt trong `< <(...)` nên stream rỗng, vòng lặp không chạy, verify báo PASS mà **chưa kiểm tra file nào**. Đây là failure mode tệ nhất của một thành phần fail-closed. Đã sửa: ghi manifest ra file tạm trước, và manifest rỗng ⇒ FAIL. Có test hồi quy riêng.
2. **`lsof` `$NF` là `(LISTEN)`, không phải địa chỉ** → allowlist seed 0 port, inventory mù hoàn toàn. Sửa: quét ngược tìm field dạng `host:port`.
3. **`find -name` phân biệt hoa thường trên APFS.** Thư mục thật tên `logs` nhưng danh sách ghi `Logs` → trượt, trong khi `[ -d ]` của bản trước lại thấy (macOS case-insensitive). Sửa: `-iname` + prune `.git`.
4. **Scan disk chỉ depth 0** → bỏ sót `mobile/node_modules` (2.0 GB của jigsawsolite). Sửa: `-maxdepth 2`. Tổng đo được đổi từ 984 MB → 2914 MB.
5. **Chính test suite rò process.** `PIDS_TO_KILL+=()` chạy trong subshell của `$(spawn)` nên mảng mất, trap cleanup không giết gì (11 `sleep` sót lại). Sửa: track PID qua file. Cùng lúc, `sleep 300 &` trong command substitution giữ pipe mở làm `$( )` treo 300s — phải redirect stdout/stderr.

Bug 5 chính là loại lỗi mà RLG sinh ra để chặn, xuất hiện ngay trong công cụ xây RLG — bằng chứng cho thấy vấn đề người dùng nêu là có thật và dễ mắc.

### Số liệu baseline (2026-07-26T14:58Z)

- 19 listening port, **0 unaccounted** (mọi thứ đang chạy đều được seed vào allowlist = hạ tầng có trước guard).
- Trong 19 port có 1 Android emulator (`qemu-system` ×6 port, `adb`, `netsimd`) — đúng nhóm process nặng mà pipeline cần quản lý.
- Disk 31 project: **2914 MB** trong các thư mục nặng; tập trung ở `jigsawsolite/mobile/node_modules` 2044 MB và `forgewright_ide/node_modules`.
- Lưu ý: `forgewright_ide` đang có `npm install` chạy từ một phiên Claude Code khác lúc đo, nên số của project đó là mục tiêu di động.

### Lệnh dùng hằng ngày

```bash
bash scripts/runtime/runtime-inventory.sh --all          # báo cáo toàn máy
bash scripts/runtime/runtime-install.sh  --status        # trạng thái guard
bash scripts/runtime/runtime-install.sh  --verify        # chống drift
bash scripts/runtime/runtime-lease.sh    status          # lease đang mở
touch ~/.forgewright/runtime/DISABLED                    # tắt khẩn cấp
```

---

## 6.6 Nhật ký triển khai P1 (2026-07-26)

### File đã tạo

| File | Vai trò |
|---|---|
| `scripts/runtime/rlg_spawn.py` | Thay `setsid` (macOS không có): `setsid()` → redirect log → `execvp` ⇒ pid == pgid, giết được cả cây bằng `kill -- -PGID` |
| `scripts/runtime/port-broker.sh` | `alloc` trả `FREE` / `REUSE` / `BUSY` |
| `scripts/runtime/dev-run.sh` | Launcher hợp lệ duy nhất; **REUSE thay vì spawn bản thứ hai** |
| `scripts/lite/runtime-pretool-gate.sh` | Hook `PreToolUse(Bash)`, chế độ observe |
| `tests/runtime/test_runtime_p1.sh` | 32 assertion |

Kết quả: shellcheck clean · P0 39/39 · P1 32/32 · `--verify` PASS trên 9 file · 0 rò rỉ.

### Khẳng định cốt lõi đã đo được

Chạy **cùng một lệnh 5 lần** → `1 lease`, `1 process listening`, 4 lần sau trả về đúng PID gốc với `reused:true`. Đây chính là R1 bị chặn.

### Ba quyết định kỹ thuật đến từ số đo thực tế

1. **Gate không dùng python.** Đo được `python3 -c 'import json'` = **59ms/lần**; hook chạy trên mọi lệnh Bash của mọi project nên không thể trả giá đó. Đường nhanh là bash builtin thuần, 0 fork. Kết quả: **p95 = 25–35ms**, dưới ngân sách 100ms.
2. **Shell hệ thống là bash 3.2.57**, không phải 4/5. `read -N` trả chuỗi rỗng với input nhiều dòng, và `-N` kết hợp `-d ''` trả rỗng cả với một dòng — đủ để biến hook thành no-op im lặng. Phải dùng `read -r -d ''` rồi cắt độ dài bằng substring builtin. Đã có test riêng cho payload nhiều dòng.
3. **Manifest ghi `src_dir` theo từng file.** Hook nằm ở `scripts/lite/` còn phần còn lại ở `scripts/runtime/`; nếu chỉ ghi một `src` chung thì một file có thể bị tráo từ thư mục khác mà `--verify` không phát hiện.

### Wiring 3 CLI — `scripts/runtime/runtime-hooks-install.sh`

Ba CLI lưu hook ở ba nơi, ba định dạng, **ba contract khác nhau**:

| CLI | File | Định dạng | Cho phép nghĩa là |
|---|---|---|---|
| Claude Code | `~/.claude/settings.json` | JSON `hooks.PreToolUse[]` | im lặng + exit 0 |
| Codex | `~/.codex/config.toml` | TOML `[[hooks.PreToolUse]]` | im lặng + exit 0 |
| Antigravity | `~/.gemini/config/hooks.json` | JSON registry theo tên | **bắt buộc in `{"decision":"allow"}`** |

Điểm nguy hiểm nhất: với AGY, **không in gì bị hiểu là từ chối**. Nên gate phải in allow trên *mọi* nhánh thoát — kể cả khi kill-switch đang tắt guard, kể cả payload rỗng. Nếu bỏ sót, việc "tắt guard" sẽ chặn đứng mọi tool call của AGY. Có 5 test riêng cho đúng chuyện này.

Installer đảm bảo: idempotent (chạy 4 lần vẫn 1 hook), không phá hook sẵn có (`gitnexus`, `forgewright-policy`), backup trước mỗi lần ghi, `--dry-run`, và `--uninstall` trả file về đúng hình dạng ban đầu. Test chạy trên **bản sao config thật** để đối mặt cấu trúc thật thay vì file đồ chơi.

```bash
bash scripts/runtime/runtime-hooks-install.sh --install [--platform all|claude|codex|agy] [--dry-run]
bash scripts/runtime/runtime-hooks-install.sh --verify | --uninstall | --status
```

Trạng thái hiện tại: đã wired cả 3, `--verify` xanh, gate **đang chạy live** ở Claude Code (xác nhận bằng gate.log tăng đúng khi lệnh khớp pattern và đứng yên khi không khớp).

Tắt bất cứ lúc nào: `touch ~/.forgewright/runtime/DISABLED` — hoặc gỡ hẳn bằng `--uninstall`.

### Một lưu ý về false positive

Gate khớp pattern trên **toàn bộ payload**, nên một lệnh chỉ *nhắc đến* `npm run dev` (ví dụ `echo "npm run dev"`) cũng bị ghi log. Ở `observe` điều đó vô hại và đúng mục đích — chính dữ liệu này sẽ dùng để chỉnh bộ nhận diện trước khi P2 được phép chặn thật.

---

## 6.7 Thay "chờ 1 tuần" bằng đo và mô phỏng (2026-07-26)

Điều kiện gate của P2 vốn là *"chạy observe ≥1 tuần rồi kiểm tra bộ nhận diện có báo nhầm không"*. Chờ đợi không phải cách duy nhất để có bằng chứng đó: máy **đã có sẵn** hơn một tuần lịch sử lệnh thật, và các trạng thái vòng đời đều **dựng thẳng ra được** bằng timestamp lùi ngày.

### A. Đo bộ nhận diện trên dữ liệu thật — `scripts/runtime/runtime-detector-eval.py`

Hai corpus, cả hai đều **độc lập với danh sách pattern** của gate:

| Corpus | Nguồn | Trả lời câu hỏi |
|---|---|---|
| A | `~/.zsh_history` (6222 dòng, 3241 lệnh duy nhất) | gate ồn tới mức nào (false positive)? |
| B | `package.json` của 15 project (169 script) | gate bỏ sót gì (false negative)? |

Nhãn của corpus B lấy từ **lệnh sau khi resolve**, không bao giờ từ dạng gõ vào — nếu không phép đo sẽ tự đồng ý với chính nó. Danh sách pattern và regex resolve được **trích thẳng từ file gate**, không chép tay, nên báo cáo không thể lệch khỏi thứ đang thực chạy.

Kết quả trước → sau khi sửa:

| Chỉ số | Trước | Sau |
|---|---|---|
| Lệnh thật bị gắn cờ | 23 / 3241 (0.71%) | **4 / 3241 (0.12%)** |
| Precision (corpus B) | 0.78 | **1.00** |
| Recall (corpus B) | 0.64 | **1.00** |
| False negative | 4 | **0** |

Bốn lệnh còn bị gắn cờ đều **đúng** (3 × `docker-compose up`, 1 × `npm run dev`) — không còn rác.

Ba khiếm khuyết thật bị lộ ra và đã sửa:

1. **`vite` khớp nhầm `vitest`.** Một pattern này chiếm 8/23 lần gắn cờ, toàn rác. Rồi `vite ` lại bắt nhầm `vite build` (lệnh tự kết thúc). Phải liệt kê tường minh `vite dev|preview|serve|--` vì POSIX ERE không có negative lookahead.
2. **`' & '` khớp văn xuôi.** "Risk & Impact", "Artifact & Approval"… chiếm 11/23. Thu hẹp về đúng dạng `… &` ngay trước dấu nháy đóng.
3. **Điểm mù `npm run <tên>`.** Lệnh gõ vào không nói gì về tuổi thọ — `npm run preview`, `test:watch`, `electron:start` đều mở process sống lâu. Gate nay resolve script từ `package.json` ở nhánh chậm (chỉ với lệnh `npm/yarn run`, bằng `grep`, không dùng python).

**Cảnh báo trung thực:** detector được sửa *dựa trên chính corpus này*, nên 1.00/1.00 là mức khớp với môi trường thật của máy này, **không phải bảo chứng tổng quát**. Thước đo cũng từng sai theo hướng làm detector trông tệ hơn thực tế (oracle mắc đúng lỗi `vite`/`vitest`, và không resolve được `dev:cli → cd src/cli && npm run dev → tsup --watch` nằm ở package.json khác) — đã sửa cả thước đo.

### B. Mô phỏng vòng đời có tua nhanh thời gian — `tests/runtime/test_runtime_p2_sim.sh`

Dựng thẳng 5 trạng thái bằng lease có timestamp lùi (25 giờ tuổi, TTL 1 giờ), rồi kiểm tra reaper **quyết định** gì:

| Trạng thái | Quyết định |
|---|---|
| Đang sống, trong TTL | `HOLD` |
| Quá TTL | `REAP` |
| `policy=keep` (adopt) | `SKIP-KEEP` — kể cả khi đã quá hạn từ lâu |
| Port nằm trong allowlist | `SKIP-ALLOWLIST` — kể cả khi có lease và đã quá hạn |
| Process đã chết | `PRUNE` — chỉ đóng bản ghi |

Cùng các chốt an toàn: dry-run là mặc định; `--execute` bị **từ chối** khi `MODE=observe`; kill-switch chặn reaper hoàn toàn; process **không có lease** sống sót qua `--execute`; reclaim theo `--session` chỉ đụng lease của session đó. 20/20 assertion.

### C. Lỗi an toàn mà mô phỏng bắt được (một tuần quan sát sẽ không thấy)

Lần chạy đầu, mô phỏng **tự giết chính nó** — exit 144, không output. Nguyên nhân: `sleep &` trong script nằm **cùng process group** với test shell, reaper `kill -TERM -PGID` nên quét sạch cả nhóm.

Đây không phải lỗi test mà là **lỗ hổng thật của reaper**: bất kỳ lease nào có `pgid` thuộc nhóm dùng chung — điển hình là process được `adopt` (thừa kế nhóm của shell) — sẽ khiến reaper giết oan mọi tiến trình anh em trong nhóm.

Sửa: **chỉ group-kill khi `pgid == pid`**, tức process thật sự dẫn đầu nhóm của nó (đúng thứ `rlg_spawn.py` bảo đảm cho mọi thứ do `dev-run.sh` khởi động). Ngược lại chỉ giết đúng một pid. Có test riêng: process anh em cùng nhóm phải sống sót.

### Trạng thái sau bước này

`runtime-reap.sh` đã tồn tại, đã vào manifest checksum (nó là script **duy nhất** có quyền kill), nhưng **chưa được bật**: `MODE` vẫn là `observe`, reaper mặc định dry-run, và **chưa gắn vào `SessionEnd`**. Bật thật là một quyết định riêng.

---

## 6.8 Bật P2 (2026-07-26)

### Đổi thiết kế: sweep theo TTL, không phải reclaim theo SessionEnd

Bản kế hoạch gốc thu hồi ở `SessionEnd`. Kiểm tra config **thật** của cả ba CLI cho thấy không CLI nào có sự kiện đó được dùng: Claude và Codex phơi ra `Stop`, registry của Antigravity chỉ nhận `PreToolUse`. Đoán một tên sự kiện không tồn tại sẽ tạo ra hook **im lặng không bao giờ chạy** — tệ hơn là không gắn.

Nên reclaim chuyển sang chạy theo **TTL của lease**, gắn vào `Stop`. Chặt hơn hẳn:

- không phụ thuộc vào việc CLI có sự kiện session-end hay không;
- thu hồi được cả rác của session **crash** (không bao giờ có sự kiện kết thúc sạch);
- registry là **toàn máy**, nên sweep từ Claude/Codex thu hồi luôn lease do Antigravity mở — AGY được bảo vệ mà không cần hook riêng.

Đánh đổi: server rò rỉ sống tới hết TTL (mặc định 2h, chỉnh từng lần bằng `dev-run.sh --ttl`) thay vì chết ngay khi session kết thúc.

`runtime-sweep.sh` **không bao giờ truyền `--session`**: reclaim theo session giết mọi lease của session bất kể TTL, chỉ đúng ở thời điểm session thật sự kết thúc. Trên hook chạy mỗi lượt, nó sẽ giết đúng con dev server người dùng vừa mở. Sweeper còn bị **throttle** (mặc định 300s/lần) và chạy nền để `Stop` không bị chậm.

### Chứng minh đầu-cuối trên máy thật

```
port broker  → 23920 (band cố định của project)
run lần 1    → {"reused":false,"pid":15167,"ready":true}
run lần 2    → {"reused":true, "pid":15167}          ← không mở bản thứ hai
listeners    → 1
sau TTL 20s  → health=expired
reaper       → REAP lease=rlg-fb10db… pid=15167 port=23920  TTL expired
sau sweep    → PID 15167: NO · listeners on 23920: 0 · lease closed
```

### Trạng thái sống

| | |
|---|---|
| `MODE` | `enforce` |
| Gate | Claude ✓ · Codex ✓ · AGY ✓ (`PreToolUse`) |
| Sweep | Claude ✓ · Codex ✓ · AGY n/a (được phủ qua registry chung) |
| Manifest checksum | 12 file, `--verify` xanh |
| Test | p0 39 · p1 32 · hooks 55 · p2_sim 27 = **153 assertion, 0 fail** |
| Detector trên dữ liệu thật | gắn cờ 4/3241 lệnh · P=1.00 R=1.00 FN=0 |

Số socket lắng nghe giảm 19→13 trong phiên **không phải** do RLG: emulator Android (qemu-system + netsimd) chiếm 6 port đã tự tắt, và registry ghi nhận đúng 1 lần reap duy nhất — chính là process E2E ở trên.

### Tắt

```bash
touch ~/.forgewright/runtime/DISABLED                      # dừng tức thì, mọi CLI
printf 'observe\n' > ~/.forgewright/runtime/MODE           # quay lại chỉ quan sát
bash scripts/runtime/runtime-hooks-install.sh --uninstall  # gỡ hook khỏi 3 config
```

---

## 6.9 P3 (disk) và P4 (gate) — 2026-07-26

### P3 — ngân sách disk và TTL cho artifact

| File | Vai trò |
|---|---|
| `scripts/runtime/disk-budget.sh` | Đo footprint từng project theo `budget.yaml`, verdict `OK/WARN/BLOCK`, exit 2 khi vượt block |
| `scripts/runtime/runtime-gc.sh` | Xoá artifact quá hạn — **dry-run mặc định** |
| `~/.forgewright/runtime/budget.yaml` | Ngưỡng global; project override bằng `.forgewright/budget.yaml` |

Xoá là nửa nguy hiểm của P3 nên `runtime-gc.sh` cố ý hẹp: chỉ đụng **allowlist thư mục** mà chính pipeline sinh ra (`$RLG_HOME/logs`, `.forgewright/{verify,reports,escalations}`), chỉ file thường, chỉ quá TTL, không bao giờ quét cây project tìm thứ "trông có vẻ bỏ đi". Log của lease **đang mở** không bao giờ bị xoá dù bao nhiêu tuổi.

Số đo thật: 31 project, jigsawsolite **4667 MB** (sát ngưỡng cảnh báo 5 GB — `mobile/node_modules` 4.5 G), forgewright_ide 981 MB, còn lại dưới 10 MB.

### P4 — biến quy tắc thành thứ bắt buộc

- `kernel/VERIFY.md` — **Template 4: RUNTIME LEDGER**, cộng Rule 8: task nào mở process sống lâu thì phải kèm block này. *"Test pass"* không phải bằng chứng máy được để lại sạch.
- `kernel/SOLVE.md` §9.4 — bước **Runtime reclaim** trong TURN-CLOSE.
- `kernel/ESCALATE.md` — tín hiệu HARD mới: định giết process **không có lease**, hoặc định reap lease `policy=keep`.
- `CLAUDE.md` / `AGENTS.md` / `GEMINI.md` — regenerate bằng `sync-kernel.py` (không sửa tay).
- Overlay 10 skill hay spawn process: devops, qa, frontend, fullstack, game, godot, unity, phaser3, mobile, threejs.
- `scripts/ci/verify-runtime-leases.sh` — nối vào `run-required-checks.sh`. Nó **không** đòi guard phải được cài trên máy CI (sẽ fail mọi checkout sạch) mà khẳng định **source còn nguyên các thanh chắn**: dry-run vẫn là mặc định, vẫn từ chối `--execute` khi observe, vẫn skip allowlist/keep, vẫn chỉ group-kill khi `pgid == pid`, sweeper vẫn không truyền `--session`, gate vẫn fail-open và vẫn in allow cho AGY. Một lần sửa tương lai gỡ mất thanh chắn nào là build đỏ.
- Sweeper ghi `rule-ledger.sh add RLG-01 violation` mỗi khi thật sự thu hồi được thứ gì — rò rỉ trở thành tín hiệu cho vòng self-healing thay vì bị dọn im lặng mãi mãi.

### Hai bug lộ ra ở bước này

1. **`"${targets[@]}"` trên mảng rỗng** = "unbound variable" dưới `set -u` trong bash 3.2. Chỉ lộ ra khi gọi `runtime-gc.sh` **không** kèm `--project` — tức đúng cách gọi mặc định. Đã guard bằng `${#targets[@]}`.
2. **Fixture test P0 bị lỗi thời**: nó copy danh sách file cứng, nên mỗi lần thêm file vào manifest là 7 assertion đỏ. Nay fixture đọc thẳng `RLG_FILES` từ installer.

### Tổng kết

| | |
|---|---|
| Script | 14 file trong manifest checksum |
| Test | p0 39 · p1 32 · hooks 55 · p2_sim 27 = **153 assertion, 0 fail** |
| Detector | 4/3241 lệnh thật · P=1.00 R=1.00 FN=0 |
| CI | `verify-runtime-leases` nối vào required checks |
| Chế độ | `enforce`, wired live trên cả 3 CLI |

---

## 7. Ngoài phạm vi (Out of scope)

- Quản lý container Docker dài hạn (chỉ detect `docker compose up`, chưa quản lý lifecycle container).
- Giới hạn RAM cứng theo cgroup/`launchd` — macOS không có cgroup, cần hướng khác.
- Dọn `node_modules` tự động (rủi ro cao, chỉ báo cáo).
- Quản lý process của các máy/CI runner từ xa.
