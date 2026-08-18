---
id: qa-test-protocol
title: QA Testing & Test Case Design Protocol — Shared Reference
summary: Core protocol for qa test protocol.
status: active
version: 1.0.0
owners: [core]
triggers: []
used_by: [all]
related: []
supersedes: []
superseded_by: null
---
# QA Testing & Test Case Design Protocol — Shared Reference

> **Mọi game skill (qa-engineer, autonomous-testing, eval-engineer, software/frontend/mobile specialists) đều tham chiếu document này.** Cung cấp nền tảng lý thuyết kiểm thử, quy trình viết test case tối ưu độ bao phủ, cách viết kịch bản BDD/Gherkin chuẩn và các kỹ thuật Shift-Left/Shift-Right trong CI/CD.

---

## 1. Định nghĩa Vai trò: QA vs. QC trong Hệ thống

Hệ thống quản lý chất lượng (Quality Management) được phân chia rõ rệt thành hai khía cạnh tương hỗ:

*   **Quality Assurance (QA) - Định hướng Quy trình (Process-oriented / Preventive):**
    *   Tập trung vào việc thiết kế, xây dựng và cải tiến quy trình phát triển phần mềm để đảm bảo đội ngũ "làm đúng ngay từ đầu" và ngăn ngừa lỗi xuất hiện (Preventive).
    *   *Nhiệm vụ trong Forgewright:* Xác định tiêu chuẩn code, lập quy hoạch kiểm thử, cấu hình Quality Gate trong CI/CD, thực thi rà soát quy trình.
*   **Quality Control (QC) - Định hướng Sản phẩm (Product-oriented / Detective):**
    *   Tập trung vào kiểm tra sản phẩm đầu ra thực tế nhằm phát hiện, phân loại và khoanh vùng các lỗi hiện hữu trước khi phát hành (Detective).
    *   *Nhiệm vụ trong Forgewright:* Chạy các bộ test suite (unit, integration, visual regression, E2E), rà soát code (code review), ghi nhận và phân loại lỗi.

### Liên kết Chỉ số Đo lường (ISO/IEC 14598-1)
Các chỉ số quy trình nội bộ (Internal Metrics) chỉ thực sự có giá trị khi chúng ta chứng minh được bằng thống kê rằng chúng có mối tương quan chặt chẽ với chất lượng sản phẩm đầu ra (External Indicators).

| Chỉ số Quy trình QA (Internal) | Chỉ số Tin cậy QC (External) |
| :--- | :--- |
| Độ phức tạp cấu trúc code (WMC, CBO) | Tần suất xuất hiện lỗi trong vận hành thực tế |
| Mức độ đầu tư kiểm thử (Test LOC / Source LOC) | Mật độ lỗi thực tế (Defect Density - số lỗi/KLOC) |
| Phát hiện lỗi sớm trong giai đoạn phát triển | Khả năng dễ bảo trì (Maintainability) |

### 1.5 Test Oracle Integrity — Requirement Lock

Test case là **executable contract của requirement đã được chấp nhận**, không phải
cơ chế để hợp thức hóa implementation hiện tại. Quy tắc này áp dụng cho unit,
integration, E2E, visual snapshots/goldens, eval datasets, expected outputs và
mọi assertion/oracle tương đương.

1. **Requirement owns expected behavior.** Trước khi viết hoặc thay đổi expected
   behavior, phải xác định requirement/acceptance criterion hiện hành làm nguồn.
   Test đang fail, code hiện tại, hoặc mục tiêu "all tests pass" không được xem là
   bằng chứng requirement đã đổi.
2. **Existing behavioral test cases are read-only unless the requirement changes.**
   Không sửa expected value, assertion, snapshot/golden baseline, eval label,
   tolerance, skip/xfail, hoặc xóa scenario chỉ để làm test pass.
3. **Requirement thiếu hoặc mâu thuẫn => BLOCKED, hỏi người dùng/PO.** Không dùng
   assumption/default để tự quyết expected behavior. Nếu test có vẻ sai hoặc cũ
   nhưng requirement chưa đổi, báo contradiction và yêu cầu xác nhận/cập nhật
   requirement trước khi sửa test case.
4. **Requirement đổi => update requirement first, tests second.** Test mutation
   phải trace được tới requirement/acceptance delta hiện tại; sau đó mới propagate
   thay đổi vào test và implementation.
5. **Infrastructure-only repair is allowed without requirement change** khi chỉ
   sửa runner/config/setup/teardown/deterministic plumbing và chứng minh scenario,
   assertions, expected behavior và coverage không đổi.

Failure triage mặc định: requirement rõ + test fail => sửa product code; requirement
không đủ rõ => hỏi; requirement đã thay đổi rõ ràng => cập nhật requirement-linked
test rồi mới dùng nó để verify implementation.

---

## 2. Các Kỹ thuật Thiết kế Test Case Nâng cao

Để đạt được tiêu chí "Kiểm thử đầy đủ" (Adequate Testing) mà không làm phình to số lượng test case, các kỹ thuật phân tích hộp đen và hộp trắng sau phải được áp dụng:

### 2.1 Phân vùng tương đương (EP) & Phân tích giá trị biên (BVA)
*   **Equivalence Partitioning (EP):** Chia miền dữ liệu đầu vào thành các lớp tương đương (hợp lệ và không hợp lệ). Chỉ cần chọn một giá trị đại diện trong mỗi lớp để kiểm thử.
*   **Boundary Value Analysis (BVA):** Tập trung kiểm thử các giá trị ngay tại biên và hai bên sát sườn của biên (ví dụ: đối với khoảng $[18, 60]$, các giá trị biên cần test là $17$, $18$, $60$, $61$).

### 2.2 Bảng Quyết định (Decision Tables) & Đồ thị ddgraph
*   **Bảng Quyết định:** Sử dụng cho các tính năng có logic nghiệp vụ phức tạp phụ thuộc vào nhiều điều kiện đầu vào kết hợp.
*   **Đồ thị ddgraph (Decision-to-Decision Graph):** Rút gọn từ Control Flow Graph (CFG) bằng cách loại bỏ các nút chỉ có duy nhất 1 luồng vào và 1 luồng ra. Giúp tối ưu hóa đường đi để phân tích độ bao phủ nhánh (branch coverage) và luồng dữ liệu một cách hiệu quả nhất.

### 2.3 Kiểm thử Tổ hợp (Combinatorial / Pairwise Testing)
Khi hệ thống có quá nhiều tham số cấu hình đầu vào, việc test toàn bộ tổ hợp là bất khả thi. Áp dụng **Mảng Phủ (Covering Array - CA)** để đảm bảo bao phủ toàn bộ tương tác $t$-way (thường là $t=2$ cho cặp đôi - Pairwise).
Ký hiệu: $CA(N; t, k, v)$
*   $N$: Số lượng test case tối thiểu sau khi tối ưu.
*   $k$: Số lượng tham số đầu vào (Factors).
*   $v$: Số lượng giá trị có thể chọn của mỗi tham số (Levels).
*   $t$: Độ mạnh của tương tác cần phủ (ví dụ: $t=2$ đảm bảo mọi cặp giá trị của 2 tham số bất kỳ đều được test chung ít nhất một lần).

---

## 3. Quy chuẩn Kiểm thử Hành vi: BDD & Gherkin

Behavior-Driven Development (BDD) là cầu nối giao tiếp giữa Nghiệp vụ (PO/BA), Phát triển (Dev) và Kiểm thử (QA) - mô hình "Three Amigos". Việc viết kịch bản hành vi tốt giúp giảm thiểu độ mơ hồ của yêu cầu và tăng chất lượng code đầu ra.

### 3.1 Quy tắc Gherkin (Given - When - Then)
*   **Given (Bối cảnh):** Thiết lập trạng thái ban đầu của hệ thống (ví dụ: người dùng đã đăng nhập, số dư tài khoản).
*   **When (Hành động):** Tác nhân thực thi một hành động chủ động (ví dụ: người dùng nhấn nút, hàm `foo` được gọi).
*   **Then (Kết quả mong muốn):** Kiểm tra trạng thái mới của hệ thống hoặc kết quả trả về thông qua các câu khẳng định (Assertions).

### 3.2 Khẳng định (Assertions) vs. Thuộc tính (Properties)
*   **Assertion-based Testing:** Kiểm thử đơn lẻ một kịch bản với dữ liệu tĩnh cố định (ví dụ: `assertEqual(calculate(50, 20), 40)`).
*   **Property-Based Testing (PBT):** Khai báo các tính chất/quy luật luôn đúng của hệ thống đối với mọi đầu vào hợp lệ. Sử dụng các công cụ (như Fast-Check hoặc Hypothesis) để tự động sinh ra **100 giá trị ngẫu nhiên** để tìm kiếm trường hợp biên gây lỗi (falsifying example).
    *   *Ví dụ Thuộc tính:* `prop_discount x = calculateDiscount(x) <= x` (Tiền giảm giá luôn nhỏ hơn hoặc bằng tổng tiền gốc).

### 3.3 Mẫu Kịch bản Hành vi Chuẩn
```gherkin
Feature: Xử lý Giao dịch Tài chính

  Scenario Outline: Áp dụng chiết khấu dựa trên hạng thành viên và giá trị đơn hàng
    Given Một người dùng có hạng thành viên là "<membership>"
    When Người dùng thực hiện thanh toán đơn hàng trị giá <total> USD
    Then Số tiền chiết khấu nhận được phải là <discount> USD
    And Tổng số tiền thực trả phải là <final_pay> USD

    Examples:
      | membership | total | discount | final_pay |
      | Gold       | 100   | 10       | 90        |
      | Silver     | 100   | 5        | 95        |
      | Bronze     | 100   | 0        | 100       |
```

---

## 4. Đo lường Độ bao phủ & Mutation Testing

### 4.1 Các loại Độ bao phủ (Coverage)
*   **Block Coverage:** Đảm bảo tất cả các khối lệnh cơ bản (basic blocks) đều được chạy qua ít nhất một lần.
*   **Branch Coverage:** Đảm bảo mọi nhánh rẽ tại cấu trúc điều kiện (if/else, switch) đều được kiểm thử ở cả hai trạng thái `true` và `false`.
*   **Call-Stack Depth Coverage:** Đo lường độ sâu tối đa của ngăn xếp cuộc gọi trong hệ thống. Rất quan trọng đối với các ứng dụng hướng sự kiện (event-driven) hoặc đa giao diện để phát hiện các luồng thực thi ngầm.

### 4.2 Kiểm thử Đột biến (Mutation Testing) & Chỉ số FEP
Mutation testing là công cụ tối thượng để kiểm tra xem bộ test case của bạn có thực sự "chất lượng" hay không.
1.  Hệ thống tự động chèn các lỗi cú pháp nhỏ vào mã nguồn gốc để tạo ra các bản thể lỗi (**Mutants**).
2.  Chạy bộ test suite hiện tại đối với các Mutants này.
3.  Nếu có ít nhất 1 test case thất bại (phát hiện ra lỗi), Mutant đó bị **tiêu diệt (Killed)**. Ngược lại, Mutant **sống sót (Survived)**, chứng tỏ bộ test case bị thiếu sót kịch bản kiểm tra lỗi tại vùng code đó.
4.  **FEP (Fault Exposing Potential) Score:** Khả năng phát hiện lỗi của bộ test.
    *   *FEP-Total:* Chiến lược ưu tiên các test case tiêu diệt được tổng số lượng mutants nhiều nhất.
    *   *FEP-Additional:* Chiến lược ưu tiên các test case tiêu diệt các mutants chưa từng được bao phủ bởi các test case trước đó.

---

## 5. Quy trình Kiểm thử Liên tục: Shift-Left & Shift-Right

Để tối ưu hóa chi phí sửa lỗi, Forgewright áp dụng song song hai mô hình kiểm thử dịch chuyển:

```
SHIFT-LEFT (Phòng ngừa lỗi sớm) ◄─── [ PHÁT TRIỂN / CI ] ───► SHIFT-RIGHT (Vận hành thực tế)
  - Unit/Integration Testing              - Canary Deployments
  - TDD / Static Analysis                 - Synthetic Monitoring
  - Code Review & Linting                 - Log Analysis & Chaos Engineering
```

### 5.1 Các Chỉ số Đo lường DORA & QA
*   **Change Failure Rate (CFR):** Tỷ lệ phần trăm các lần triển khai lên production gây ra lỗi và yêu cầu khắc phục ngay lập tức (rollback, hotfix). CFR là cán cân kiểm soát chất lượng đối với tần suất release.
*   **Defect Density (Mật độ lỗi):**
    $$\text{Defect Density} = \frac{\text{Số lượng lỗi phát hiện}}{\text{Tổng số KLOC (Nghìn dòng code)}}$$
*   **Mô hình cảnh báo sớm STREW:** Theo dõi tỷ lệ giữa Code kiểm thử / Code logic nghiệp vụ, tỷ lệ cảnh báo biên dịch mẫu (pattern warnings), và cấu trúc kiểu dữ liệu để dự báo mật độ lỗi trước khi release.

### 5.2 Tối ưu hóa Bộ kiểm thử Hồi quy (Regression Suite Optimization)
1.  **Thu nhỏ bộ test (Test Suite Minimization):** Tối ưu **tập test được chọn để chạy** bằng Hitting Set mà không tự xóa hay thay đổi các test case requirement-linked đang tồn tại. Xóa/merge/đổi behavioral test case trong repository vẫn là test-oracle mutation và chỉ được phép sau explicit requirement change.
2.  **Lựa chọn test case thông minh (Regression Test Selection - RTS):** Chỉ chọn chạy các test case đi qua các phân vùng mã nguồn có sự thay đổi (được chỉnh sửa, thêm mới hoặc xóa bỏ) thông qua giải thuật Graph-Walk.
3.  **Sắp xếp thứ tự ưu tiên (Test Case Prioritization):** Sắp xếp thứ tự chạy test case để đạt chỉ số **APFD (Average Percentage of Fault Detection)** cao nhất, giúp phát hiện lỗi nhanh nhất có thể trong quá trình chạy CI.

---

## 6. Checklist Thực Thi cho QA & Developers

- [ ] Phân tích miền giá trị đầu vào bằng EP và BVA cho tất cả các tham số.
- [ ] Xây dựng bảng quyết định cho các chức năng có logic điều kiện phức tạp.
- [ ] Áp dụng Pairwise testing cho các tổ hợp cấu hình môi trường/thiết bị.
- [ ] Viết kịch bản Gherkin (Given-When-Then) rõ ràng trước khi code (Shift-Left).
- [ ] Đảm bảo 100% độ bao phủ (Branch Coverage) đối với các luồng nghiệp vụ cốt lõi (Critical Paths).
- [ ] Thực hiện dọn dẹp môi trường (setup/tear down) độc lập giữa các test case để tránh flaky tests.
- [ ] Tích hợp chạy tự động toàn bộ Unit/Integration tests vào CI/CD gate trước khi merge PR.
- [ ] Giám sát tỷ lệ Change Failure Rate (CFR) sau mỗi đợt phát hành sản phẩm.
