import os
import subprocess
import time
import requests
import json
import yaml

TOKEN = os.environ.get("FORGEWRIGHT_TELEGRAM_BOT_TOKEN", "").strip()
API_URL = f"https://api.telegram.org/bot{TOKEN}" if TOKEN else ""
LAST_UPDATE_ID_FILE = "/root/state/telegram_last_update_id.txt"
MINIMAX_KEY = os.environ.get("FORGEWRIGHT_MINIMAX_API_KEY", "").strip()
ADMIN_SECRET = os.environ.get("FORGEWRIGHT_ADMIN_SECRET", "").strip()


def get_last_update_id():
    if os.path.exists(LAST_UPDATE_ID_FILE):
        with open(LAST_UPDATE_ID_FILE, "r") as f:
            return int(f.read().strip())
    return None


def set_last_update_id(update_id):
    os.makedirs(os.path.dirname(LAST_UPDATE_ID_FILE), exist_ok=True)
    with open(LAST_UPDATE_ID_FILE, "w") as f:
        f.write(str(update_id))


def send_message(chat_id, text):
    try:
        resp = requests.post(
            f"{API_URL}/sendMessage", json={"chat_id": chat_id, "text": text}
        )
        if resp.status_code != 200:
            print(
                f"Failed to send message {chat_id}: {resp.status_code} - {resp.text}",
                flush=True,
            )
    except Exception as e:
        print(f"Failed to send message: {e}", flush=True)


def get_system_status():
    status_text = ""
    projects_file = "/root/projects/projects.yaml"
    state_dir = "/root/state"

    projects = {}
    if os.path.exists(projects_file):
        try:
            with open(projects_file, "r") as f:
                data = yaml.safe_load(f)
                projects = data.get("projects", {}) if data else {}
        except Exception:
            pass  # noqa: E722, E701

    states = {}
    if os.path.exists(state_dir):
        for f in os.listdir(state_dir):
            if f.startswith("progress_") and f.endswith(".json"):
                pid = f.replace("progress_", "").replace(".json", "")
                try:
                    with open(os.path.join(state_dir, f), "r") as st:
                        states[pid] = json.load(st)
                except Exception:
                    pass  # noqa: E722, E701

    if not projects and not states:
        return "Chưa có dự án nào trong hệ thống."

    for pid, pinfo in projects.items():
        if isinstance(pinfo, dict):
            desc = pinfo.get("description", "No desc")
            status = states.get(pid, {}).get("status", "SLEEPING")
            current_task = states.get(pid, {}).get("task", "None")
            status_text += f"- Dự án: [{pid}] | Trạng thái: {status} | Tiến độ task: {current_task} | Mô tả: {desc}\n"

    return status_text


def call_coordinator(task_text):
    sys_status = get_system_status()
    prompt = f"""
Bạn là Tiểu Mơ - Trợ lý Điều phối (Project Coordinator) chuyên nghiệp của OpenClaw.
Tính cách: Thông minh, xưng hô 'em/Sếp' hoặc 'Tiểu Mơ/Sếp', nói chuyện tự nhiên như người Việt Nam bình thường.

**TRẠNG THÁI CÁC DỰ ÁN VPS HIỆN TẠI:**
{sys_status}

**TIN NHẮN CHỈ ĐẠO CỦA SẾP:**
"{task_text}"

**YÊU CẦU NGHIÊM NGẶT CỦA HỆ THỐNG:**
Đọc tin nhắn và quyết định bạn cần phản hồi ở role nào:

1. GIAO TIẾP / BÁO CÁO (Intent: "chat"):
   - Nếu nhắn tin trò chuyện bình thường, hỏi tiến độ, lỗi vặt.
   - Trả lời Sếp dựa trên TRẠNG THÁI cung cấp ở trên.

2. GIAO VIỆC LẬP TRÌNH (TẠO MỚI HOẶC UPDATE) (Intent phải xác định):
   - LUẬT THÉP CỦA HỆ THỐNG: Nếu yêu cầu CỦA SẾP quá chung chung, mơ hồ (VD: "làm cho anh 1 trang web game", "em update chức năng login đi"), BẠN TUYỆT ĐỐI KHÔNG ĐƯỢC CHẠY TASK (VẪN ĐỂ INTENT = "chat"). Bạn phải NHẮN TIN TỪ CHỐI NHẬN LỆNH và yêu cầu Sếp cung cấp thêm thông tin nghiệp vụ/luồng/thiết kế chi tiết trước khi bắt đầu.
   - CHỈ KHI NÀO SẾP CUNG CẤP CÓ ĐỦ CHI TIẾT: Chuyển `intent` thành "task", nhận diện `project_id` cũ hoặc tự sinh `project_id`. Viết câu trả lời: "Dạ thông tin chi tiết lắm rồi Sếp ạ, em nhận lệnh khởi tạo luồng chạy cho đội dev luôn đây!"

**YÊU CẦU ĐẦU RA:**
Chỉ trả về MỘT FILE JSON duy nhất.
{{
    "intent": "chat" hoặc "task",
    "project_id": "id-dự-án" (Chỉ điền nếu intent là task),
    "task_brief": "tóm tắt ngắn gọn requirement Sếp đưa ra" (Chỉ điền nếu intent là task),
    "reply": "Câu trả lời gửi cho Sếp."
}}
"""
    if not MINIMAX_KEY:
        return {
            "intent": "chat",
            "reply": "LLM coordinator is not configured (FORGEWRIGHT_MINIMAX_API_KEY).",
        }
    headers = {
        "Authorization": f"Bearer {MINIMAX_KEY}",
        "Content-Type": "application/json",
    }
    payload = {
        "model": "MiniMax-M2.1",
        "messages": [{"role": "user", "content": prompt}],
        "temperature": 0.3,
    }
    try:
        resp = requests.post(
            "https://api.minimax.io/v1/text/chatcompletion_v2",
            headers=headers,
            json=payload,
            timeout=30,
        )
        content = resp.json()["choices"][0]["message"]["content"].strip()
        if content.startswith("```json"):
            content = content[7:]  # noqa: E701
        if content.endswith("```"):
            content = content[:-3]  # noqa: E701
        return json.loads(content.strip())
    except Exception:  # noqa: E722
        return {"intent": "chat", "reply": "Dạ kết nối LLM lag nhẹ, Sếp chờ xíu nhé!"}


def main():
    if not TOKEN:
        raise SystemExit("FORGEWRIGHT_TELEGRAM_BOT_TOKEN is required")
    print("Telegram Conversational Listener Started...", flush=True)
    while True:
        try:
            offset = get_last_update_id()
            params = {"timeout": 30}
            if offset:
                params["offset"] = offset + 1  # noqa: E701

            response = requests.get(f"{API_URL}/getUpdates", params=params, timeout=40)
            if response.status_code == 200:
                for update in response.json().get("result", []):
                    set_last_update_id(update["update_id"])
                    print(f"RAW UPDATE: {update}", flush=True)

                    if "message" in update and "text" in update["message"]:
                        chat_id = update["message"]["chat"]["id"]
                        text = update["message"]["text"]

                        try:
                            requests.post(
                                f"{API_URL}/sendChatAction",
                                json={"chat_id": chat_id, "action": "typing"},
                                timeout=5,
                            )
                        except Exception as e:
                            print(f"Failed to send typing action: {e}", flush=True)

                        decision = call_coordinator(text)

                        send_message(
                            chat_id, decision.get("reply", "Dạ tuân lệnh sếp!")
                        )

                        if decision.get("intent") == "task":
                            pid = decision.get("project_id", "default").lower()
                            brief = decision.get("task_brief", text)

                            # Phase 16: Security Gatekeeper for System Core
                            if (
                                pid in ["tieumo", "forgewright", "openclaw"]
                                or "tiểu mơ" in pid.replace("-", " ")
                                or "forgewright" in pid
                            ):
                                if not ADMIN_SECRET or ADMIN_SECRET not in text:
                                    send_message(
                                        chat_id,
                                        "⚠️ LỖI BẢO MẬT: Nhận dạng yêu cầu can thiệp Lõi Hệ Thống. Yêu cầu nhập đúng Mật khẩu Quản trị (Admin) trong chỉ thị!",
                                    )
                                    continue

                            projects_file = "/root/projects/projects.yaml"
                            try:
                                with open(projects_file, "r") as f:
                                    data = yaml.safe_load(f)
                                    if not data:
                                        data = {"projects": {}}  # noqa: E701
                            except Exception as e:
                                print(f"Error loading projects: {e}", flush=True)
                                data = {"projects": {}}

                            if pid not in data["projects"]:
                                data["projects"][pid] = {
                                    "description": brief[:60],
                                    "status": "active",
                                }
                                os.makedirs(
                                    os.path.dirname(projects_file), exist_ok=True
                                )
                                with open(projects_file, "w") as f:
                                    yaml.dump(data, f, allow_unicode=True)

                            subprocess.Popen(
                                [
                                    "/root/scripts/task-runner.sh",
                                    brief,
                                    pid,
                                    str(chat_id),
                                    "",
                                ],
                                stdout=subprocess.PIPE,
                                stderr=subprocess.PIPE,
                                text=True,
                            )
        except Exception as e:
            import traceback

            print(f"LOOP FATAL ERROR: {e}\n{traceback.format_exc()}", flush=True)
        time.sleep(1)


if __name__ == "__main__":
    main()
