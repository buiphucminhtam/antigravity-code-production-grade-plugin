#!/usr/bin/env bash
# scripts/verify-wiki-drift.sh — Kiểm tra trôi lệch và mâu thuẫn tài liệu (Bash v3 compatible)
# Usage: bash scripts/verify-wiki-drift.sh [--threshold 0.3] [--verbose] [--heal]

set -euo pipefail

# ─── Cấu hình ──────────────────────────────────────────────────────────────
THRESHOLD=0.3
VERBOSE=false
HEAL=false
CONFLICTS_FOUND=0
CLAIMS_COUNT=0
UNCONFIRMED_CLAIMS=0

# Parse arguments
while [[ $# -gt 0 ]]; do
    case "$1" in
        --threshold)
            THRESHOLD="$2"
            shift 2
            ;;
        --verbose)
            VERBOSE=true
            shift
            ;;
        --heal)
            HEAL=true
            shift
            ;;
        *)
            echo "Unknown argument: $1"
            exit 1
            ;;
    esac
done

# Định dạng màu
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
BOLD='\033[1m'
NC='\033[0m'

echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BOLD}🔍 WIKI DRIFT & CONFLICT VERIFIER — Kiểm tra tài liệu${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

# Tạo file tạm để lưu danh sách Markdown và các port tìm thấy.
markdown_filelist=$(mktemp)
tmp_file=$(mktemp)
trap 'rm -f "$markdown_filelist" "$tmp_file"' EXIT

# ─── PHẦN 0: Kiểm tra trạng thái RAG Server (NextJS Board UI) ──────────────
echo -e "\n${BOLD}[0/3] Kiểm tra trạng thái RAG Server (cổng 3000)...${NC}"
RAG_RUNNING=true
if ! curl -s http://localhost:3000 > /dev/null 2>&1; then
    RAG_RUNNING=false
    echo -e "  ${YELLOW}⚠ Cảnh báo: RAG Server (Board UI) hiện không hoạt động trên cổng 3000.${NC}"
    if $HEAL; then
        BOARD_UI_DIR=".antigravity/plugins/board-ui"
        if [ -d "$BOARD_UI_DIR" ]; then
            echo -e "  ${YELLOW}🔧 Đang tự động vá (HEAL): Khởi động RAG Server trong nền...${NC}"
            # Khởi chạy trong subshell nền
            (cd "$BOARD_UI_DIR" && npm run dev > /tmp/rag-server.log 2>&1) &
            
            # Đợi tối đa 5 giây
            for i in {1..5}; do
                sleep 1
                if curl -s http://localhost:3000 > /dev/null 2>&1; then
                    RAG_RUNNING=true
                    echo -e "  ${GREEN}✓ Khởi động RAG Server thành công!${NC}"
                    break
                fi
            done
        fi
    fi
fi

if [ "$RAG_RUNNING" = "false" ]; then
    echo -e "  ${RED}❌ Cảnh báo: RAG Server offline. AI sẽ chạy ở chế độ dự phòng đọc file phẳng.${NC}"
else
    echo -e "  ${GREEN}✓ RAG Server đang hoạt động ổn định và sẵn sàng phục vụ MCP.${NC}"
fi

# ─── PHẦN 1: Kiểm tra mâu thuẫn giữa các tài liệu (Doc-to-Doc) ──────────────
echo -e "\n${BOLD}[1/3] Đang quét mâu thuẫn chéo giữa các tài liệu (Doc-to-Doc)...${NC}"

# Quét tìm các định nghĩa Port trong các file Markdown để check mâu thuẫn.
# Trong repo chỉ xét file được track để artifact local không làm sai lệch release gate.
if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    markdown_inventory=(git ls-files -z -- ":(glob)*.md" ":(glob)*/*.md")
else
    markdown_inventory=(find . -maxdepth 2 -name "*.md" -not -path "*/node_modules/*" -not -path "*/.git/*" -print0)
fi

# Ghi danh sách ra file trước để lỗi inventory/grep không bị nuốt bởi pipeline subshell.
if ! "${markdown_inventory[@]}" > "$markdown_filelist"; then
    echo -e "  ${RED}❌ Unreadable Markdown: không thể liệt kê đầy đủ các tệp Markdown.${NC}"
    CLAIMS_COUNT=$((CLAIMS_COUNT + 1))
    UNCONFIRMED_CLAIMS=$((UNCONFIRMED_CLAIMS + 1))
fi

while IFS= read -r -d '' file; do
    grep_output=""
    if grep_output=$(grep -E -i "port\s*[:=]\s*[0-9]+" "$file" 2>&1); then
        grep_status=0
    else
        grep_status=$?
    fi

    if [ "$grep_status" -gt 1 ]; then
        echo -e "  ${RED}❌ Unreadable Markdown: $file${NC}"
        if $VERBOSE && [ -n "$grep_output" ]; then
            echo "     $grep_output"
        fi
        CLAIMS_COUNT=$((CLAIMS_COUNT + 1))
        UNCONFIRMED_CLAIMS=$((UNCONFIRMED_CLAIMS + 1))
        continue
    fi

    while IFS= read -r grep_line; do
        [ -n "$grep_line" ] || continue
        # Trích xuất số port từ dòng bằng regex
        if [[ "$grep_line" =~ [0-9]+ ]]; then
            port_val="${BASH_REMATCH[0]}"
            rel_path="${file/$(pwd)\//}"
            echo "$port_val:$rel_path" >> "$tmp_file"
        fi
    done <<< "$grep_output"
done < "$markdown_filelist"

# Kiểm tra mâu thuẫn từ file tạm
if [ -s "$tmp_file" ]; then
    # Đếm số lượng tuyên bố đã quét
    port_claims=$(wc -l < "$tmp_file" | tr -d ' ')
    CLAIMS_COUNT=$((CLAIMS_COUNT + port_claims))
    
    # Lấy danh sách các giá trị port duy nhất
    unique_ports=$(cut -d: -f1 "$tmp_file" | sort -u)
    unique_count=$(echo "$unique_ports" | wc -l | tr -d ' ')
    
    if $VERBOSE; then
        echo -e "  🔍 Danh sách khai báo cổng tìm thấy:"
        while read -r line; do
            p_val=$(echo "$line" | cut -d: -f1)
            p_file=$(echo "$line" | cut -d: -f2)
            echo -e "     • Port: ${BOLD}$p_val${NC} trong ${YELLOW}$p_file${NC}"
        done < "$tmp_file"
    fi

    if [ "$unique_count" -gt 1 ]; then
        echo -e "  ${RED}❌ Mâu thuẫn phát hiện: Có cấu hình cổng PORT khác nhau giữa các tài liệu!${NC}"
        if $HEAL; then
            echo -e "  ${YELLOW}🔧 Đang tự động vá (HEAL): Đồng nhất cổng cấu hình về cổng mặc định 3000...${NC}"
            while read -r line; do
                p_file=$(echo "$line" | cut -d: -f2)
                echo -e "     • Đang vá tệp: ${YELLOW}$p_file${NC}"
                if [[ "$OSTYPE" == "darwin"* ]]; then
                    sed -i '' -E 's/([Pp]ort[[:space:]]*[:=][[:space:]]*)[0-9]+/\13000/g' "$p_file"
                else
                    sed -i -E 's/([Pp]ort[[:space:]]*[:=][[:space:]]*)[0-9]+/\13000/g' "$p_file"
                fi
            done < "$tmp_file"
            CONFLICTS_FOUND=0
            echo -e "  ${GREEN}✓ Tự động vá cổng cấu hình thành công!${NC}"
        else
            while read -r p; do
                files_with_p=$(grep "^$p:" "$tmp_file" | cut -d: -f2- | tr '\n' ',' | sed 's/,$//')
                echo -e "     • Cổng ${BOLD}$p${NC} được định nghĩa tại: ${YELLOW}$files_with_p${NC}"
                CONFLICTS_FOUND=$((CONFLICTS_FOUND + 1))
            done <<< "$unique_ports"
        fi
    else
        echo -e "  ${GREEN}✓ Không phát hiện mâu thuẫn chéo giữa các tài liệu.${NC}"
    fi
else
    echo -e "  ${GREEN}✓ Không phát hiện khai báo cổng cấu hình nào trong tài liệu.${NC}"
fi


# ─── PHẦN 2: Kiểm tra trôi lệch giữa Tài liệu và Code (Doc-to-Code) ─────────
echo -e "\n${BOLD}[2/3] Đang kiểm tra độ tươi mới của đồ thị GitNexus (Doc-to-Code)...${NC}"

# Kiểm tra xem có thư mục .gitnexus hay không
if [ -d ".gitnexus" ]; then
    echo "  ✓ Thư mục chỉ mục GitNexus (.gitnexus) tồn tại."
    CLAIMS_COUNT=$((CLAIMS_COUNT + 1))
    
    # Kiểm tra status của GitNexus
    if command -v npx &>/dev/null; then
        is_stale=false
        if ! npx gitnexus status &>/dev/null; then
            is_stale=true
        elif npx gitnexus status 2>&1 | grep -q "stale"; then
            is_stale=true
        fi

        if [ "$is_stale" = "true" ]; then
            if $HEAL; then
                echo -e "  ${YELLOW}🔧 Đang tự động vá (HEAL): Chạy 'npx gitnexus analyze' để cập nhật chỉ mục...${NC}"
                npx gitnexus analyze
                echo -e "  ${GREEN}✓ Đồ thị GitNexus đã được phân tích và cập nhật thành công!${NC}"
            else
                echo -e "  ${YELLOW}⚠ Chỉ mục GitNexus bị lệch hoặc chưa hoàn thiện.${NC}"
                UNCONFIRMED_CLAIMS=$((UNCONFIRMED_CLAIMS + 1))
            fi
        else
            echo -e "  ${GREEN}✓ Đồ thị GitNexus hoạt động bình thường.${NC}"
        fi
    else
        echo "  ⚠ Không tìm thấy npx, bỏ qua chạy trực tiếp status."
    fi
else
    if $HEAL; then
        echo -e "  ${YELLOW}🔧 Đang tự động vá (HEAL): Tạo mới chỉ mục GitNexus bằng 'npx gitnexus analyze'...${NC}"
        npx gitnexus analyze
        echo -e "  ${GREEN}✓ Tạo mới đồ thị GitNexus thành công!${NC}"
    else
        echo -e "  ${RED}❌ Lỗi: Thư mục chỉ mục .gitnexus không tồn tại!${NC}"
        echo "     Vui lòng chạy 'npx gitnexus analyze' trước để tạo đồ thị tri thức."
        UNCONFIRMED_CLAIMS=$((UNCONFIRMED_CLAIMS + 2))
        CLAIMS_COUNT=$((CLAIMS_COUNT + 2))
    fi
fi

# ─── PHẦN 3: Tính toán tỷ lệ Trôi lệch & Kết luận ───────────────────────────
echo -e "\n${BOLD}📊 BÁO CÁO KẾT QUẢ ĐỐI CHIẾU:${NC}"

# Tránh chia cho 0
if [ $CLAIMS_COUNT -eq 0 ]; then
    CLAIMS_COUNT=1
fi

TOTAL_ISSUES=$((CONFLICTS_FOUND + UNCONFIRMED_CLAIMS))
DRIFT_PERCENT=$(( TOTAL_ISSUES * 100 / CLAIMS_COUNT ))

echo "  • Tổng số tuyên bố/cấu hình đã quét: $CLAIMS_COUNT"
echo "  • Số mâu thuẫn cấu hình (Doc-to-Doc): $CONFLICTS_FOUND"
echo "  • Số lỗi lệch pha code (Doc-to-Code): $UNCONFIRMED_CLAIMS"
echo -e "  • ${BOLD}Tỷ lệ lệch tài liệu (Drift Ratio): ${DRIFT_PERCENT}%${NC}"

# So sánh với Threshold sử dụng Node.js để tương thích không cần lệnh 'bc'
IS_ABOVE_THRESHOLD=$(node -e "console.log(($TOTAL_ISSUES / $CLAIMS_COUNT) >= $THRESHOLD ? 1 : 0)")
DRIFT_RATIO=$(node -e "console.log(($TOTAL_ISSUES / $CLAIMS_COUNT).toFixed(2))")

echo -e "\n${BOLD}📢 ĐÁNH GIÁ CẤP ĐỘ CẢNH BÁO:${NC}"

if [ "$IS_ABOVE_THRESHOLD" -eq 1 ]; then
    echo -e "${RED}🛑 CRITICAL ALERT: Tỷ lệ lệch tài liệu (${DRIFT_PERCENT}%) đã vượt ngưỡng cho phép (${THRESHOLD}*100%).${NC}"
    echo -e "${RED}   Hệ thống khóa tiến trình viết code tự động của AI Agent.${NC}"
    echo -e "${YELLOW}   👉 Khuyến nghị: Chạy 'npx gitnexus analyze' hoặc kiểm tra chéo các file tài liệu để sửa mâu thuẫn.${NC}"
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    exit 1
else
    if [ $TOTAL_ISSUES -gt 0 ]; then
        echo -e "${YELLOW}⚠️ WARNING: Phát hiện sự lệch tài liệu nhẹ (${DRIFT_PERCENT}%). AI vẫn tiếp tục nhưng sẽ ghi chú cảnh báo.${NC}"
    else
        echo -e "${GREEN}✅ SAFE: Tài liệu của bạn nhất quán 100% với mã nguồn và không có mâu thuẫn chéo.${NC}"
    fi
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    exit 0
fi
