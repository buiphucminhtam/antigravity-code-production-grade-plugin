import os
import sys
import json
import asyncio
import hashlib
import re
import time
import requests
from dataclasses import dataclass
from pathlib import Path
from typing import Any, List, Dict
from contextlib import AsyncExitStack

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

# Repo-relative paths — derived from this script's own location.
_SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
_REPO_ROOT = str(Path(__file__).resolve().parents[2])
if _SCRIPT_DIR not in sys.path:
    sys.path.insert(0, _SCRIPT_DIR)

from skill_routing import route_skills  # noqa: E402 — sys.path must precede this repo-relative import.

# Provider / model are read exclusively from env vars so that the harness
# controls them without needing to hard-code any model name in this file.
_PROVIDER = os.environ.get("FORGEWRIGHT_PROVIDER", "runtime")


def _first_nonempty(*values: str | None) -> str:
    return next((value.strip() for value in values if value and value.strip()), "")


def resolve_model(environ: dict[str, str] | None = None) -> str:
    env = os.environ if environ is None else environ
    model = _first_nonempty(env.get("FORGEWRIGHT_MODEL"), env.get("NINEROUTER_MODEL"))
    if not model:
        raise ValueError(
            "FORGEWRIGHT_MODEL is required (NINEROUTER_MODEL is a legacy fallback)"
        )
    return model


def resolve_api_url(environ: dict[str, str] | None = None) -> str:
    env = os.environ if environ is None else environ
    exact_url = _first_nonempty(env.get("FORGEWRIGHT_API_URL"))
    if exact_url:
        return exact_url
    legacy_base = _first_nonempty(env.get("NINEROUTER_BASE_URL"))
    if legacy_base:
        if legacy_base.endswith("/chat/completions"):
            return legacy_base
        return legacy_base.rstrip("/") + "/chat/completions"
    return "https://api.minimax.io/v1/text/chatcompletion_v2"


def resolve_code_dir(value: str) -> str:
    path = Path(value).expanduser().resolve(strict=True)
    if not path.is_dir():
        raise ValueError(f"code_dir is not a directory: {path}")
    if path == Path(path.anchor):
        raise ValueError("code_dir cannot be the filesystem root")
    return str(path)


def _positive_int(environ: dict[str, str], name: str, default: int) -> int:
    raw = environ.get(name, str(default))
    try:
        value = int(raw)
    except ValueError as error:
        raise ValueError(f"{name} must be a positive integer") from error
    if value <= 0:
        raise ValueError(f"{name} must be a positive integer")
    return value


def _optional_positive_int(environ: dict[str, str], name: str) -> int | None:
    """Read an optional positive limit; missing or zero means unlimited."""
    raw = environ.get(name)
    if raw is None or not raw.strip():
        return None
    try:
        value = int(raw)
    except ValueError as error:
        raise ValueError(f"{name} must be a positive integer or 0") from error
    if value < 0:
        raise ValueError(f"{name} must be a positive integer or 0")
    return value or None


@dataclass(frozen=True)
class RuntimeLimits:
    max_turns: int | None
    max_tool_calls_per_turn: int
    max_tool_calls_total: int
    max_output_tokens: int
    max_http_response_bytes: int
    max_tool_argument_bytes: int
    max_tool_result_bytes: int
    max_context_bytes: int
    max_tools: int
    max_tool_schema_bytes: int
    mcp_timeout_seconds: int
    runtime_timeout_seconds: int

    @classmethod
    def from_env(cls, environ: dict[str, str] | None = None) -> "RuntimeLimits":
        env = dict(os.environ if environ is None else environ)
        return cls(
            # Goal execution has no default turn quota. An explicit positive
            # value remains available as an emergency runtime circuit breaker.
            max_turns=_optional_positive_int(env, "FORGEWRIGHT_MAX_TURNS"),
            max_tool_calls_per_turn=_positive_int(
                env, "FORGEWRIGHT_MAX_TOOL_CALLS_PER_TURN", 8
            ),
            max_tool_calls_total=_positive_int(
                env, "FORGEWRIGHT_MAX_TOOL_CALLS_TOTAL", 40
            ),
            max_output_tokens=_positive_int(env, "FORGEWRIGHT_MAX_OUTPUT_TOKENS", 8192),
            max_http_response_bytes=_positive_int(
                env, "FORGEWRIGHT_MAX_HTTP_RESPONSE_BYTES", 2_000_000
            ),
            max_tool_argument_bytes=_positive_int(
                env, "FORGEWRIGHT_MAX_TOOL_ARGUMENT_BYTES", 100_000
            ),
            max_tool_result_bytes=_positive_int(
                env, "FORGEWRIGHT_MAX_TOOL_RESULT_BYTES", 250_000
            ),
            max_context_bytes=_positive_int(
                env, "FORGEWRIGHT_MAX_CONTEXT_BYTES", 1_000_000
            ),
            max_tools=_positive_int(env, "FORGEWRIGHT_MAX_TOOLS", 256),
            max_tool_schema_bytes=_positive_int(
                env, "FORGEWRIGHT_MAX_TOOL_SCHEMA_BYTES", 500_000
            ),
            mcp_timeout_seconds=_positive_int(
                env, "FORGEWRIGHT_MCP_TIMEOUT_SECONDS", 120
            ),
            runtime_timeout_seconds=_positive_int(
                env, "FORGEWRIGHT_RUNTIME_TIMEOUT_SECONDS", 3600
            ),
        )


def qualified_tool_name(server: str, tool: str) -> str:
    raw = f"mcp_{server}__{tool}"
    sanitized = re.sub(r"[^A-Za-z0-9_-]", "_", raw)
    digest = hashlib.sha256(raw.encode("utf-8")).hexdigest()[:8]
    prefix = sanitized[: 64 - len(digest) - 2]
    return f"{prefix}__{digest}"


def _serialized_size(value: Any) -> int:
    return len(
        json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    )


def _read_bounded_response(response: Any, max_bytes: int) -> str:
    chunks: list[bytes] = []
    total = 0
    for chunk in response.iter_content(chunk_size=65_536):
        if not chunk:
            continue
        total += len(chunk)
        if total > max_bytes:
            raise RuntimeError("runtime budget exceeded: HTTP response bytes")
        chunks.append(chunk)
    return b"".join(chunks).decode("utf-8", errors="replace")


_MODEL = _first_nonempty(
    os.environ.get("FORGEWRIGHT_MODEL"), os.environ.get("NINEROUTER_MODEL")
)

# MiniMax-specific config is optional and only used when provider == "minimax".
_API_KEY = _first_nonempty(
    os.environ.get("FORGEWRIGHT_API_KEY"),
    os.environ.get("NINEROUTER_API_KEY"),
    os.environ.get("MINIMAX_API_KEY"),
)
_BASE_URL = resolve_api_url()


class ForgewrightAgent:
    def __init__(self, project_id: str, code_dir: str):
        self.project_id = project_id
        self.code_dir = resolve_code_dir(code_dir)
        self.messages = []
        self.limits = RuntimeLimits.from_env()
        self._started_at: float | None = None

    def _remaining_timeout(self, operation_cap: float) -> float:
        if self._started_at is None:
            return min(operation_cap, float(self.limits.runtime_timeout_seconds))
        remaining = self.limits.runtime_timeout_seconds - (
            time.monotonic() - self._started_at
        )
        if remaining <= 0:
            raise RuntimeError("runtime budget exceeded: total runtime")
        return min(operation_cap, remaining)

    def _call_api(self, tools: List[Dict]) -> Dict:
        """Call the Chat Completions API."""
        if not _API_KEY:
            print(
                "[!] FORGEWRIGHT_API_KEY, NINEROUTER_API_KEY, or MINIMAX_API_KEY env var is not set."
            )
            sys.exit(1)
        if not _MODEL:
            print("[!] FORGEWRIGHT_MODEL env var is not set.")
            sys.exit(1)
        headers = {
            "Authorization": f"Bearer {_API_KEY}",
            "Content-Type": "application/json",
        }

        if _serialized_size(self.messages) > self.limits.max_context_bytes:
            raise RuntimeError("runtime budget exceeded: context bytes")
        data = {
            "model": _MODEL,
            "messages": self.messages,
            "temperature": 0.1,
            "max_tokens": self.limits.max_output_tokens,
        }
        if tools:
            data["tools"] = tools

        print(f"[*] Calling {_PROVIDER}/{_MODEL} (Messages: {len(self.messages)})...")
        resp = requests.post(
            _BASE_URL,
            headers=headers,
            json=data,
            timeout=self._remaining_timeout(120),
            stream=True,
        )
        response_text = _read_bounded_response(
            resp, self.limits.max_http_response_bytes
        )

        if response_text.startswith("data: "):
            lines = response_text.split("\n")
            content = ""
            tool_calls = {}
            for line in lines:
                line = line.strip()
                if line.startswith("data: ") and line != "data: [DONE]":
                    try:
                        chunk = json.loads(line[6:])
                        if not chunk.get("choices"):
                            continue
                        delta = chunk["choices"][0].get("delta", {})
                        if "content" in delta and delta["content"]:
                            content += delta["content"]
                        if "tool_calls" in delta:
                            for tc in delta["tool_calls"]:
                                tc_index = tc.get("index")
                                if tc_index not in tool_calls:
                                    tool_calls[tc_index] = {
                                        "id": tc.get("id"),
                                        "type": tc.get("type", "function"),
                                        "function": {"name": "", "arguments": ""},
                                    }
                                if tc.get("function"):
                                    if (
                                        "name" in tc["function"]
                                        and tc["function"]["name"]
                                    ):
                                        tool_calls[tc_index]["function"]["name"] += tc[
                                            "function"
                                        ]["name"]
                                    if (
                                        "arguments" in tc["function"]
                                        and tc["function"]["arguments"]
                                    ):
                                        tool_calls[tc_index]["function"][
                                            "arguments"
                                        ] += tc["function"]["arguments"]
                    except Exception:  # noqa: E722
                        pass

            message = {"role": "assistant"}
            if content:
                message["content"] = content
            if tool_calls:
                message["tool_calls"] = [
                    tool_calls[idx] for idx in sorted(tool_calls.keys())
                ]
            return message
        else:
            try:
                text = response_text.replace("data: [DONE]", "").strip()
                resp_json = json.loads(text)
            except Exception:
                print(f"[!] API Error, non-JSON response: {repr(response_text)}")
                sys.exit(1)

            if "choices" not in resp_json:
                print(f"[!] API Error: {resp_json}")
                sys.exit(1)

            return resp_json["choices"][0]["message"]

    async def run(self, task: str):
        import subprocess

        self._started_at = time.monotonic()

        # 1. Auto-Setup MCP for the project if manifest does not exist
        manifest_path = os.path.join(self.code_dir, ".antigravity", "mcp-manifest.json")
        forgewright_manifest_path = os.path.join(
            self.code_dir, "..", ".forgewright", "mcp-manifest.json"
        )
        if not os.path.exists(manifest_path) and not os.path.exists(
            forgewright_manifest_path
        ):
            print(
                f"[*] Missing MCP Manifest in '{self.code_dir}'. Running auto-setup..."
            )
            # Use the repo-relative mcp-setup script.
            mcp_setup_script = os.path.join(
                _REPO_ROOT, "scripts", "forgewright-mcp-setup.sh"
            )
            try:
                subprocess.run(
                    ["bash", mcp_setup_script],
                    cwd=self.code_dir,
                    check=True,
                    timeout=self._remaining_timeout(300),
                )
            except Exception as e:
                print(f"[!] Warning: Auto-setup failed: {e}")

        # Define isolated path for DB
        gitnexus_db_path = os.path.normpath(
            os.path.join(self.code_dir, "..", "gitnexus_db")
        )

        gitnexus_env = {**os.environ}
        gitnexus_env["FORGEWRIGHT_WORKSPACE"] = self.code_dir
        gitnexus_env["GITNEXUS_DB"] = gitnexus_db_path

        mcp_servers = [
            {
                "name": "filesystem",
                "params": StdioServerParameters(
                    command="npx",
                    args=[
                        "-y",
                        "@modelcontextprotocol/server-filesystem",
                        self.code_dir,
                    ],
                    env=gitnexus_env,
                ),
            },
            {
                "name": "gitnexus",
                "params": StdioServerParameters(
                    command="gitnexus",
                    args=["mcp"],
                    cwd=self.code_dir,
                    env=gitnexus_env,
                ),
            },
        ]
        if os.environ.get("FORGEWRIGHT_ENABLE_NLM", "").lower() in {"1", "true", "yes"}:
            mcp_servers.append(
                {
                    "name": "nlm",
                    "optional": True,
                    "params": StdioServerParameters(
                        command="nlm", args=["mcp"], env={**os.environ}
                    ),
                }
            )

        if os.path.exists(
            os.path.join(self.code_dir, ".antigravity", "mcp-manifest.json")
        ) or os.path.exists(
            os.path.join(self.code_dir, "..", ".forgewright", "mcp-manifest.json")
        ):
            # Use the repo-relative launcher script.
            mcp_launcher = os.path.join(
                _REPO_ROOT, "scripts", "forgewright-mcp-launcher.sh"
            )
            mcp_servers.append(
                {
                    "name": "forgewright",
                    "optional": True,
                    "params": StdioServerParameters(
                        command="bash",
                        args=[mcp_launcher],
                        env={**os.environ, "FORGEWRIGHT_WORKSPACE": self.code_dir},
                    ),
                }
            )

        # Extract project context for the agent runtime.
        project_context = ""
        readme_path = os.path.join(self.code_dir, "README.md")
        profile_path = os.path.join(
            self.code_dir, "..", ".forgewright", "project-profile.json"
        )
        pkg_path = os.path.join(self.code_dir, "package.json")

        try:
            if os.path.exists(readme_path):
                with open(readme_path, "r", encoding="utf-8") as f:
                    project_context = f.read()[:2000]
            elif os.path.exists(profile_path):
                with open(profile_path, "r", encoding="utf-8") as f:
                    project_context = f.read()[:2000]
            elif os.path.exists(pkg_path):
                with open(pkg_path, "r", encoding="utf-8") as f:
                    project_context = f.read()[:2000]
            else:
                project_context = "Chưa có thông tin README.md hoặc project-profile.json. Đây có thể là dự án mới khởi tạo."
        except Exception:
            project_context = "Không thể đọc thông tin ngữ cảnh dự án do lỗi cấp quyền hoặc định dạng file."

        # Determine if running in Lite mode vs Legacy Mode
        use_lite = os.environ.get("FORGEWRIGHT_LITE", "false").lower() == "true"

        if use_lite:
            script_dir = os.path.dirname(os.path.abspath(__file__))
            repo_root = os.path.abspath(os.path.join(script_dir, "../.."))
            kernel_dir = os.path.join(repo_root, "kernel")

            entry_content = ""
            solve_content = ""
            verify_content = ""
            escalate_content = ""

            entry_path = os.path.join(kernel_dir, "ENTRY.md")
            if os.path.exists(entry_path):
                with open(entry_path, "r", encoding="utf-8") as f:
                    entry_content = f.read()

            solve_path = os.path.join(kernel_dir, "SOLVE.md")
            if os.path.exists(solve_path):
                with open(solve_path, "r", encoding="utf-8") as f:
                    solve_content = f.read()

            verify_path = os.path.join(kernel_dir, "VERIFY.md")
            if os.path.exists(verify_path):
                with open(verify_path, "r", encoding="utf-8") as f:
                    verify_content = f.read()

            escalate_path = os.path.join(kernel_dir, "ESCALATE.md")
            if os.path.exists(escalate_path):
                with open(escalate_path, "r", encoding="utf-8") as f:
                    escalate_content = f.read()

            # The local config owns ordered mode routing and its cap. Ordinary
            # prompts with no configured mode intentionally keep the safe base
            # Lite prompt without a skill overlay.
            routing = route_skills(prompt=task, project_root=repo_root)
            if routing["status"] != "ok":
                raise RuntimeError(
                    "skill routing failed: " + "; ".join(routing["errors"])
                )

            skill_overlay_content = ""
            for skill in routing["skills"]:
                with open(skill["lite_path"], "r", encoding="utf-8") as f:
                    skill_overlay_content += (
                        f"\n## Skill-Specific Instructions: {skill['name']}\n"
                        f"{f.read()}\n"
                    )
                print(f"[*] Loaded skill LITE overlay: {skill['name']}")

            system_prompt = f"""
{entry_content}

{solve_content}

{verify_content}

{escalate_content}
"""
            if skill_overlay_content:
                system_prompt += (
                    f"\n## Skill-Specific Instructions\n{skill_overlay_content}\n"
                )

            system_prompt += f"""
## Current Task Context
- Project: '{self.project_id}'
- Workspace: '{self.code_dir}'

Nhiệm vụ từ Sếp: {task}
Áp dụng SOLVE.md theo effort class phù hợp; không xuất scratchpad hoặc chain-of-thought.
"""
        else:
            system_prompt = f"""
Bạn là Forgewright Agent Executor.
Dự án bạn đang làm việc: '{self.project_id}'
Thư mục mã nguồn cục bộ: '{self.code_dir}'
Thư mục Database GitNexus của dự án (Isolate Data): '{gitnexus_db_path}'

[NGỮ CẢNH DỰ ÁN TÓM TẮT]:
{project_context}

[YÊU CẦU BẮT BUỘC]:
1. Bạn phải TỰ CHỦ sử dụng các Function Tools (do hệ thống MCP cung cấp) để dọc mã nguồn, tạo thư mục, viết/sửa code theo yêu cầu của Sếp.
2. Cấm "đoán" cấu trúc thư mục, hãy dùng lệnh thích hợp để list file trước khi sửa hoặc viết đè.
3. Luôn đảm bảo bạn tự kiểm tra code sau khi viết. 
4. Nếu có tool hỗ trợ chạy Terminal, bạn được phép gọi các lệnh như `npm run build` hoặc `test` để tự Debug kết quả.

Nhiệm vụ từ Sếp: {task}
Khi bạn nghĩ rằng mình ĐÃ THỰC THI XONG VÀ HOÀN CHỈNH CODE, hãy trả về kết quả bằng văn bản bình thường (không gọi tool nữa) để hệ thống kết thúc và deploy.
"""
        self.messages.append({"role": "system", "content": system_prompt.strip()})
        self.messages.append(
            {"role": "user", "content": f"Bắt đầu xử lý tính năng: {task}"}
        )

        try:
            async with AsyncExitStack() as stack:
                active_sessions = {}
                for srv in mcp_servers:
                    try:
                        # AnyIO's stdio client owns a task-local cancel scope. Using
                        # asyncio.wait_for() here enters that scope in a child task,
                        # while AsyncExitStack closes it in this task and crashes
                        # cleanup with "exit cancel scope in a different task".
                        # asyncio.timeout() preserves task identity.
                        async with asyncio.timeout(
                            self._remaining_timeout(self.limits.mcp_timeout_seconds)
                        ):
                            read, write = await stack.enter_async_context(
                                stdio_client(srv["params"])
                            )
                            session = await stack.enter_async_context(
                                ClientSession(read, write)
                            )
                        await asyncio.wait_for(
                            session.initialize(),
                            timeout=self._remaining_timeout(
                                self.limits.mcp_timeout_seconds
                            ),
                        )
                        active_sessions[srv["name"]] = session
                        print(f"[✓] MCP Server connected: {srv['name']}")
                    except Exception as e:
                        print(
                            f"[!] Warning: Failed to connect to MCP Server: {srv['name']} - {e}"
                        )
                        if not srv.get("optional", False):
                            raise RuntimeError(
                                f"Required MCP server failed: {srv['name']}"
                            ) from e

                if not active_sessions:
                    raise RuntimeError(
                        "No MCP Servers could be connected. Check dependencies."
                    )

                tools_payload = []
                tool_to_session_map = {}
                for srv_name, session in active_sessions.items():
                    mcp_tools = await asyncio.wait_for(
                        session.list_tools(),
                        timeout=self._remaining_timeout(
                            self.limits.mcp_timeout_seconds
                        ),
                    )
                    for tool in mcp_tools.tools:
                        exposed_name = qualified_tool_name(srv_name, tool.name)
                        if exposed_name in tool_to_session_map:
                            raise RuntimeError(
                                f"Qualified MCP tool collision: {exposed_name}"
                            )
                        tool_to_session_map[exposed_name] = (session, tool.name)
                        tools_payload.append(
                            {
                                "type": "function",
                                "function": {
                                    "name": exposed_name,
                                    "description": tool.description,
                                    "parameters": tool.inputSchema,
                                },
                            }
                        )
                if len(tools_payload) > self.limits.max_tools:
                    raise RuntimeError("runtime budget exceeded: tool count")
                if _serialized_size(tools_payload) > self.limits.max_tool_schema_bytes:
                    raise RuntimeError("runtime budget exceeded: tool schema bytes")

                total_tool_calls = 0
                turn = 0
                while True:
                    turn += 1
                    if (
                        self.limits.max_turns is not None
                        and turn > self.limits.max_turns
                    ):
                        raise RuntimeError("runtime limit exceeded: max turns")
                    if (
                        time.monotonic() - self._started_at
                        > self.limits.runtime_timeout_seconds
                    ):
                        raise RuntimeError("runtime budget exceeded: total runtime")

                    # 2. ReAct reasoning with MiniMax
                    reply = self._call_api(tools_payload)
                    self.messages.append(reply)

                    # 3. Tool Execution Phase
                    if "tool_calls" in reply and reply["tool_calls"]:
                        if (
                            len(reply["tool_calls"])
                            > self.limits.max_tool_calls_per_turn
                        ):
                            raise RuntimeError(
                                "runtime budget exceeded: tool calls per turn"
                            )
                        for tcall in reply["tool_calls"]:
                            tname = tcall["function"]["name"]
                            total_tool_calls += 1
                            if total_tool_calls > self.limits.max_tool_calls_total:
                                raise RuntimeError(
                                    "runtime budget exceeded: total tool calls"
                                )
                            raw_arguments = tcall["function"].get("arguments", "")
                            if (
                                len(raw_arguments.encode("utf-8"))
                                > self.limits.max_tool_argument_bytes
                            ):
                                raise RuntimeError(
                                    "runtime budget exceeded: tool argument bytes"
                                )
                            targs = json.loads(raw_arguments)
                            if not isinstance(targs, dict):
                                raise ValueError(
                                    "MCP tool arguments must decode to an object"
                                )
                            print(f" ⚙️  Thực thi Tool: {tname} | Args: {targs}")

                            target = tool_to_session_map.get(tname)
                            if not target:
                                res_text = f"Execution Error: Unknown tool {tname} - It was not supplied by any connected MCP server."
                            else:
                                target_session, original_tool_name = target
                                try:
                                    result = await asyncio.wait_for(
                                        target_session.call_tool(
                                            original_tool_name, arguments=targs
                                        ),
                                        timeout=self._remaining_timeout(
                                            self.limits.mcp_timeout_seconds
                                        ),
                                    )
                                    res_text = "\n".join(
                                        [
                                            c.text
                                            for c in result.content
                                            if hasattr(c, "text")
                                        ]
                                    )
                                except Exception as e:
                                    res_text = f"Execution Error: {str(e)}"
                            if (
                                len(res_text.encode("utf-8"))
                                > self.limits.max_tool_result_bytes
                            ):
                                raise RuntimeError(
                                    "runtime budget exceeded: tool result bytes"
                                )

                            self.messages.append(
                                {
                                    "role": "tool",
                                    "tool_call_id": tcall["id"],
                                    "name": tname,
                                    "content": res_text,
                                }
                            )
                    else:
                        # Final output reached
                        final_str = reply.get("content", "")
                        print(f"\n[🏁 KẾT THÚC TASK]\n{final_str}")
                        break
        except Exception as err:
            print(f"[!] Orchestrator Error: {str(err)}")
            sys.exit(1)


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print(
            "Usage: python3 forgewright-orchestrator.py <PROJECT_ID> <TASK_PROMPT> [CODE_DIR]"
        )
        sys.exit(1)

    pid = sys.argv[1]
    task_desc = sys.argv[2]
    # Default to a subdirectory inside the repo root rather than /root/projects.
    cdir = (
        sys.argv[3]
        if len(sys.argv) > 3
        else os.path.join(_REPO_ROOT, "projects", pid, "code")
    )

    agent = ForgewrightAgent(pid, cdir)
    asyncio.run(agent.run(task_desc))
