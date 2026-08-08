# Antigravity — Forgewright Planning System

> **Strategic planning layer cho những features phức tạp.** Antigravity tạo planning documents có cấu trúc trước khi bắt đầu implementation.

## ⚡ Quick Start

```bash
# 1. Create new feature plan
./scripts/antigravity/antigravity.sh new my-feature

# 2. Edit the files
cd antigravity/planning/my-feature
vim PLAN.md SCOPE.md TASKS.md

# 3. Pass the applicable STANDARD/DEEP plan threshold (Antigravity is not for QUICK work)

# 4. Track progress
./scripts/antigravity/antigravity.sh status
./scripts/antigravity/antigravity.sh progress my-feature

# 5. Archive when done
./scripts/antigravity/antigravity.sh archive my-feature
```

## Overview

Antigravity là nơi lưu trữ tất cả các kế hoạch, tài liệu thiết kế, và documentation cho các features lớn của Forgewright.

### Khi nào cần Antigravity?

| Feature Type | Antigravity? |
|--------------|--------------|
| Single file change | ❌ Không cần |
| Small feature (1-2 components) | ❌ Không cần |
| Medium feature (3+ components) | ⚠️ Chỉ khi coordination/architecture thực sự cần artifact bền vững |
| Full Build / Game Build | ⚠️ Dùng khi scope đủ lớn/đa lane; không bắt buộc chỉ vì tên mode |
| Multi-team coordination | ✅ Có |
| New high-risk integration (auth, payment, etc.) | ✅ Thường nên dùng |

### Pipeline Integration

```
User Request
    ↓
[Request Interpretation - Step 0]
    ↓
[Mode Classification - Step 1]
    ↓
[Large Feature? YES → antigravity/ planning/]
    ↓
[Plan Quality Loop - Step 2]
    ↓
[Skill Execution]
```

## Cấu Trúc Thư Mục

```
antigravity/
├── README.md                      # File này
│
├── planning/                      # Feature planning documents
│   ├── README.md                  # Planning guidelines
│   │
│   ├── template/                  # Planning templates
│   │   ├── PLAN.md               # Main planning template
│   │   ├── SCOPE.md              # Scope definition template
│   │   ├── ARCHITECTURE.md        # Architecture template
│   │   └── TASKS.md              # Task breakdown template
│   │
│   └── [feature-name]/           # Per-feature folders
│       ├── PLAN.md               # Feature plan
│       ├── SCOPE.md              # Scope definition
│       ├── ARCHITECTURE.md        # Technical architecture
│       ├── TASKS.md              # Task breakdown
│       ├── DECISIONS.md          # Architecture decisions log
│       └── RETROSPECTIVE.md      # Post-completion retrospective
│
└── docs/                          # Reference documentation
    ├── README.md                  # Docs guidelines
    ├── API.md                     # API design reference
    ├── DATABASE.md                # Database design reference
    ├── UI.md                      # UI/UX design reference
    └── SECURITY.md                # Security checklist reference
```

## Quick Start

### 1. Tạo Feature Planning

```bash
# Tạo thư mục cho feature mới
mkdir -p antigravity/planning/[feature-name]

# Copy templates
cp antigravity/planning/template/* antigravity/planning/[feature-name]/
```

### 2. Điền thông tin

Mỗi file có hướng dẫn chi tiết. Điền theo thứ tự:

1. **SCOPE.md** — Xác định boundary (trong/ngoài scope)
2. **ARCHITECTURE.md** — Thiết kế technical architecture
3. **PLAN.md** — Main planning document (tổng hợp)
4. **TASKS.md** — Task breakdown theo priorities

### 3. Review & Approve

Sau khi tạo xong planning, present cho user:
- Scope definition
- Architecture diagram
- Task breakdown
- Risks & Mitigations

## Planning Quality Criteria

Mỗi feature plan phải đạt:

| Criteria | Description | Threshold |
|----------|-------------|-----------|
| **Clarity** | Scope rõ ràng, không ambiguous | ≥ 8/10 |
| **Completeness** | Đủ thông tin để implement | ≥ 8/10 |
| **Feasibility** | Có thể hoàn thành trong timeframe | ≥ 7/10 |
| **Risk Awareness** | Known risks được document | ≥ 7/10 |
| **Testability** | Có clear acceptance criteria | ≥ 8/10 |
| **Maintainability** | Long-term maintainable | ≥ 7/10 |
| **Priority** | Impact vs effort rõ ràng | ≥ 8/10 |
| **Dependencies** | External deps được xác định | ≥ 7/10 |

**Overall Threshold: ≥ 9.0/10**

## Best Practices

### ✅ Nên làm

- Bắt đầu với SCOPE.md để xác định boundary
- Include architecture diagrams (Mermaid syntax)
- List explicit dependencies và risks
- Define clear acceptance criteria
- Break tasks into ≤ 4h blocks

### ❌ Không nên

- Planning quá chi tiết (paralysis by analysis)
- Bỏ qua risk assessment
- Không xác định scope boundary rõ ràng
- Tạo plan mà không có user approval

## Examples

### Example: Feature Planning Structure

```
antigravity/
└── planning/
    └── user-authentication/
        ├── PLAN.md
        │   "Main plan: Add OAuth2 + JWT authentication"
        ├── SCOPE.md
        │   "✓ Login/Logout, ✓ OAuth2 providers, ✗ Payment integration"
        ├── ARCHITECTURE.md
        │   "JWT flow, token storage, OAuth2 providers diagram"
        ├── TASKS.md
        │   "1. Setup auth service (2h), 2. Add OAuth2 (4h), ..."
        ├── DECISIONS.md
        │   "ADR-001: Use JWT over sessions - performance"
        └── RETROSPECTIVE.md
            "Completed in 3 days, 1 day over estimate"
```

## Liên quan

- **Forgewright Pipeline**: `skills/production-grade/SKILL.md`
- **Plan Quality Loop**: `skills/_shared/protocols/plan-quality-loop.md`
- **Chat Interpreter**: `.cursor/agents/chat-interpreter.md`
