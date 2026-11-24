# BÁO CÁO NGHIỆM THU AGENTIC V2.0
## Củng Cố Lõi Điều Khiển Bằng Mô Hình (Model-Driven Core Consolidation)
### Reasoning-first · Tool-driven · Business-controlled

**Dự án:** J Collection — Hệ thống Trợ lý AI Khách sạn  
**Kiến trúc:** Reasoning-first · Tool-driven · Business-controlled  
**Cơ sở áp dụng:** Jacayl Hotel Hà Đông (`jacayl-ha-dong`) — Chuẩn hóa nền tảng đa cơ sở (`JCollectionAgent`)  
**Thời điểm nghiệm thu:** 24/11/2026  
**Trạng thái quyết định:** **CONDITIONAL GO** (Chấp thuận nghiệm thu Agentic V2.0 tại Hà Đông; Cho phép vận hành nội bộ có giám sát; Nghiêm cấm triển khai production hoặc kết nối kênh khách hàng thật / PMS cho đến khi hoàn thành các điều kiện tiên quyết).

---

## MỤC LỤC
1. [Tóm Tắt Điều Hành & Trạng Thái Mốc Kiến Trúc (Executive Summary)](#1-tóm-tắt-điều-hành--trạng-thái-mốc-kiến-trúc)
2. [Kiểm Toán Kiến Trúc & Bảng Phân Loại 9 Nhóm Logic (Architecture Audit)](#2-kiểm-toán-kiến-trúc--bảng-phân-loại-9-nhóm-logic)
3. [Đồng Bộ Nguồn Sự Thật Duy Nhất (Single Source of Truth Alignment)](#3-đồng-bộ-nguồn-sự-thật-duy-nhất)
4. [Kỷ Luật Tool Allowlist & Tính Toàn Vẹn Bằng Chứng (Tools & Evidence Integrity)](#4-kỷ-luật-tool-allowlist--tính-toàn-vẹn-bằng-chứng)
5. [Quan Sát Động & Minh Chứng Vòng Lặp Suy Luận Đa Lượt (Dynamic Observation & Replanning)](#5-quan-sát-động--minh-chứng-vòng-lặp-suy-luận-đa-lượt)
6. [Bộ Giải Ràng Buộc Tổng Quát & Loại Bỏ Hoàn Toàn Hardcode (Generic Constraint Solver)](#6-bộ-giải-ràng-buộc-tổng-quát--loại-bỏ-hoàn-toàn-hardcode)
7. [Trạng Thái Có Cấu Trúc & Vòng Đời Bộ Nhớ Động (Structured State & Memory Lifecycle)](#7-trạng-thái-có-cấu-trúc--vòng-đời-bộ-nhớ-động)
8. [Sẵn Sàng Mở Rộng Đa Cơ Sở & Cô Lập Dữ Liệu (Multi-Property & Tenant Isolation)](#8-sẵn-sàng-mở-rộng-đa-cơ-sở--cô-lập-dữ-liệu)
9. [Xác Minh LLM Thực Tế Đa Provider (Groq & Gemini Dual-Provider Traces)](#9-xác-minh-llm-thực-tế-đa-provider)
10. [Bộ Kiểm Thử Phát Hiện Lỗi Tự Chủ & Tình Huống Biên (Edge Case Suite)](#10-bộ-kiểm-thử-phát-hiện-lỗi-tự-chủ--tình-huống-biên)
11. [Kết Quả Benchmark & Năng Lực Tổng Quát Hóa (Benchmark Results)](#11-kết-quả-benchmark--năng-lực-tổng-quát-hóa)
12. [Xác Minh Chất Lượng & Kiểm Toán Bất Biến Nghiệp Vụ (Quality Verification)](#12-xác-minh-chất-lượng--kiểm-toán-bất-biến-nghiệp-vụ)
13. [Bảo Vệ Đa Luồng Giao Tiếp Bảng Điều Khiển & Tiếp Quản Người (Dual-Gate Safety)](#13-bảo-vệ-đa-luồng-giao-tiếp-bảng-điều-khiển--tiếp-quản-người)
14. [Kế Hoạch Rollback & Khả Năng Khôi Phục Vận Hành (Operational Resilience)](#14-kế-hoạch-rollback--khả-năng-khôi-phục-vận-hành)
15. [Phán Quyết Nghiệm Thu & Phạm Vi Giai Đoạn Tiếp Theo (Verdict: CONDITIONAL GO)](#15-phán-quyết-nghiệm-thu--phạm-vi-giai-đoạn-tiếp-theo)

---

## 1. Tóm Tắt Điều Hành & Trạng Thái Mốc Kiến Trúc

Triển khai chỉ thị của Chủ dự án: **Dừng phương pháp phát triển bằng cách liên tục thêm regex, keyword detectors, template và điều kiện if/else để xử lý từng câu hỏi phát sinh. AI quyết định cách giải quyết vấn đề; Backend kiểm soát sự thật, nghiệp vụ, quyền hạn và thực thi.**

Phiên bản **Agentic V2.0** đánh dấu bước chuyển mình cốt lõi của J Collection từ một hệ thống deterministic lai sang kiến trúc **Model-Driven Agentic System** thực sự:
- **Tách bạch vai trò dứt khoát**: LLM chịu trách nhiệm hiểu ngữ nghĩa tự nhiên, lập kế hoạch, đề xuất công cụ từ allowlist, tiếp nhận kết quả quan sát (observations), tái lập kế hoạch khi phát hiện mâu thuẫn/thiếu dữ liệu, và diễn đạt câu trả lời tự nhiên. Backend đảm bảo bất biến nghiệp vụ, tính toán giá toán học, cô lập dữ liệu cơ sở và thẩm định phát ngôn (Claim-Level Validator).
- **Loại bỏ hardcode gợi ý phòng**: Thay thế toàn bộ logic ép phòng tĩnh (như ép phòng 201 cho khách ngân sách thấp hoặc ép phòng 101/601) bằng `GenericConstraintSolver` động và phi phụ thuộc cơ sở.
- **Mở rộng đa cơ sở sẵn sàng**: Tách lớp cốt lõi `JCollectionAgent` làm lớp cơ sở dùng chung cho toàn bộ chuỗi 3 cơ sở (`jacayl-ha-dong`, `jacayl-tran-khat-chan`, `j-village`), với cấu trúc `PropertyContext` tách biệt.
- **An toàn 2 lớp khi tiếp quản người (Dual-Gate Safety)**: Ngăn chặn 100% tình trạng AI phát ngôn ngoài ý muốn (outbound leakage) kể cả khi nhân viên can thiệp tiếp quản trong lúc tiến trình suy luận AI đang chạy ngầm (in-flight race condition).

### Bảng Chỉ Số Nghiệm Thu Agentic V2.0:

| Chỉ số kiểm định | Agentic V1.2.1 | Agentic V2.0 | Mục tiêu V2.0 | Trạng thái |
| :--- | :--- | :--- | :--- | :--- |
| **Pass Rate 100-Scenario Blind Benchmark** | 100.00% (124 turns) | **100.00%** (124 turns) | >= 98.00% | **ĐẠT** |
| **Pass Rate 100-Scenario Fresh Held-Out** | 100.00% (124 turns) | **100.00%** (124 turns) | >= 98.00% | **ĐẠT** |
| **Ungrounded Claims (Phát ngôn bịa đặt)** | 0 vi phạm | **0 vi phạm** | 0 vi phạm | **ĐẠT** |
| **Kỷ luật gọi Tool (Tool Discipline Accuracy)** | 100.00% | **100.00%** | 100.00% | **ĐẠT** |
| **Độ phủ kiểm thử lỗi tự chủ (Edge Case Suite)** | Chưa có suite riêng | **6/6 tests PASS** | 100% PASS | **ĐẠT** |
| **Xác minh Live LLM Traces (Groq & Gemini)** | Đơn lẻ | **Đầy đủ 2 provider** | Xuất artifact trace | **ĐẠT** |
| **Hardcoded Recommendation Logic** | Còn tồn đọng | **0 hardcoded rooms** | Triệt để xóa bỏ | **ĐẠT** |
| **Bảo vệ Im lặng Tiếp quản (Takeover Suppression)** | 100% (Gate 1) | **100% (Dual-Gate)** | Zero outbound | **ĐẠT** |
| **TypeScript Typecheck (`tsc --noEmit`)** | 0 lỗi | **0 lỗi** | 0 lỗi | **ĐẠT** |

---

## 2. Kiểm Toán Kiến Trúc & Bảng Phân Loại 9 Nhóm Logic

Toàn bộ đường truyền thực tế (call path) từ khi nhận gói tin đến khi phát phản hồi đã được kiểm toán:
`dashboard-server.ts` $\rightarrow$ `takeover-coordinator.ts` $\rightarrow$ `orchestrator.ts` $\rightarrow$ `hadong-agent.ts` / `jcollection-agent.ts` $\rightarrow$ `agent-tools.ts` $\rightarrow$ `ClaimLevelValidator`.

Tất cả các đoạn mã đã được phân loại rõ ràng thành 9 nhóm chức năng theo chỉ đạo kiến trúc:

| STT | Nhóm chức năng | Bản chất kỹ thuật | Xử lý tại V2.0 | Tệp tin / Dòng mã dẫn chứng |
| :---: | :--- | :--- | :--- | :--- |
| **1** | **Input Normalization** | Chuẩn hóa Unicode, loại bỏ dấu (diacritics), trích xuất số và thời gian | **GIỮ** (Hợp lý cho Backend tiền xử lý) | `src/agent/jcollection-agent.ts:250-410` |
| **2** | **Business Computation** | Tính toán biểu giá, phụ thu, ân hạn giờ, bảng giá phòng | **GIỮ** (Backend là nguồn sự thật duy nhất, LLM không được tự tính nhẩm) | `src/pricing/pricing-resolver.ts:15-180`, `src/agent/agent-tools.ts:335-390` |
| **3** | **Permission Enforcement** | Kiểm tra quyền RBAC, cô lập cơ sở (tenant isolation), chặn prompt injection | **GIỮ** (Bảo vệ an ninh bắt buộc của hệ thống) | `src/agent/agent-tools.ts:208-211`, `src/agent/jcollection-agent.ts:256-264` |
| **4** | **Data Integrity Validation** | Kiểm định schema Zod, xác minh claim phát ngôn dựa trên bằng chứng | **GIỮ** (Chốt chặn ngăn chặn ảo giác và rò rỉ dữ liệu) | `src/agent/agent-contracts.ts:24-42`, `src/agent/jcollection-agent.ts:960-966` |
| **5** | **Operational Resilience** | Tiếp quản của nhân viên (Human Takeover), giám sát tiến trình đa luồng | **GIỮ & NÂNG CẤP** (Triển khai Dual-Gate bảo vệ in-flight race condition) | `src/agent/jcollection-agent.ts:223, 952-956` |
| **6** | **Semantic Understanding** | Nhận diện mục đích, từ chối phòng, khôi phục lựa chọn, phủ định | **CHUYỂN SANG MODEL-DRIVEN** (Phối hợp LLM & Structured State Manager) | `src/agent/generic-constraint-solver.ts:13-106`, `src/agent/jcollection-agent.ts:300-335` |
| **7** | **Tool Selection** | Đề xuất công cụ đọc dữ liệu từ allowlist dựa trên nhu cầu thực tế | **CHUYỂN SANG MODEL-DRIVEN** (LLM đề xuất theo schema, fallback reasoner tự động) | `src/agent/jcollection-agent.ts:771-802, 1070-1290` |
| **8** | **Product Recommendation** | Ghép nối nhu cầu ngân sách và xếp hạng phòng tối ưu / nâng cấp | **CHUYỂN SANG THUẬT TOÁN ĐỘNG** (`GenericConstraintSolver`, xóa bỏ hardcode phòng) | `src/agent/generic-constraint-solver.ts:110-235` |
| **9** | **Response Generation** | Diễn đạt câu trả lời tự nhiên, câu chữ chân thành, cấu trúc rõ ràng | **CHUYỂN SANG MODEL-DRIVEN** (LLM sinh câu trả lời hoặc hàm tổng hợp tự nhiên) | `src/agent/jcollection-agent.ts:1320-1490` |

---

## 3. Đồng Bộ Nguồn Sự Thật Duy Nhất (Single Source of Truth)

Toàn bộ hệ thống tuân thủ nghiêm ngặt 3 tài liệu bất biến:
1. `data/j_collection_dataset.json` (Canonical Dataset).
2. `data/j_collection_business_policy_v1_4_3.json` (Business Policy V1.4.3).
3. `J_COLLECTION_AGENTIC_AI_TRANSFORMATION_AUDIT_v2.md` (Orientation Document).

### Bảng Đối Soát Hiện Thực Mã Nguồn:

| Dữ kiện nghiệp vụ | Quy định Canonical / Policy | Triển khai mã nguồn V2.0 | Kết quả xác minh runtime |
| :--- | :--- | :--- | :--- |
| **Giá phòng 202 ngày đêm** | 650.000đ | `src/agent/agent-tools.ts:340` (PreBookingQuoteEngine) | Trả về chính xác **650.000đ**, không sai lệch |
| **Phụ thu người thứ ba** | Chưa công bố chính thức (`UNKNOWN`) | `src/agent/jcollection-agent.ts:665`, `src/agent/agent-tools.ts:640` | Phản hồi trung thực: Hướng dẫn liên hệ lễ tân, không tự bịa 150k |
| **Tiện nghi hồ bơi / Sauna / Bếp** | Không có trong phòng (`UNKNOWN`/`FALSE`) | `src/agent/agent-tools.ts:430-445` (`has_pool: UNKNOWN`, `has_kitchen: FALSE`) | Xác nhận không công bố, từ chối cam kết ảo giác |
| **Kích thước bồn tắm / Bồn sục Jacuzzi** | Bồn tắm lớn (`TRUE`), Kích thước mét / Jacuzzi (`UNKNOWN`) | `src/agent/agent-tools.ts:420-435` | Khẳng định có bồn tắm lớn, nêu rõ kích thước cụ thể và sục bọt chưa công bố |
| **Phòng 401 Hà Đông** | Không bán (`NOT_FOR_SALE`) | `src/agent/agent-tools.ts:250, 315` | Loại bỏ 100% khỏi danh sách phòng kinh doanh và báo giá |
| **Khung giờ qua đêm** | 21:00 đến 12:00 trưa hôm sau (ân hạn 21:20) | `src/agent/jcollection-agent.ts:638`, `src/pricing/pricing-resolver.ts` | Giải thích rõ khung giờ và mức ân hạn |
| **Quy định nghỉ giờ tối thiểu** | Tối thiểu 2 tiếng, không chia nửa giá | `src/agent/jcollection-agent.ts:630` | Từ chối gói nghỉ 1 tiếng theo đúng V1.4.3 |

---

## 4. Kỷ Luật Tool Allowlist & Tính Toàn Vẹn Bằng Chứng

Hệ thống Agentic V2.0 chỉ cho phép duy nhất 5 công cụ đọc (`Read-Only Tools`) qua cổng kiểm soát an ninh `ToolGateway`:

```
+---------------------------------------------------------------------------------------+
|                                    BACKEND GATEWAY                                    |
|                                                                                       |
|  [Agent Reasoning]                                                                    |
|         │                                                                             |
|         ▼ (Proposed Tool Call)                                                        |
|  ┌───────────────┐      Schema Validation (Zod)                                       |
|  │ Tool Allowlist├────► Tenant Isolation Check (scope: this.propertyId)               |
|  └──────┬────────┘      Read-Only Guarantee (No state mutations)                     |
|         │                                                                             |
|         ├───► 1. search_rooms:   Tìm kiếm phòng (tách bạch exact vs partial matches)   |
|         ├───► 2. quote_price:    Tính giá chuẩn qua Pricing Engine (hỗ trợ batch quote)|
|         ├───► 3. get_room_facts: Dữ kiện xác nhận (CONFIRMED_TRUE / UNKNOWN)          |
|         ├───► 4. get_room_media: Hình ảnh phòng đã kiểm duyệt thực tế                |
|         └───► 5. get_policies:   Chính sách cơ sở theo chủ đề (parking, holiday,...)  |
|                                                                                       |
+---------------------------------------------------------------------------------------+
```

### Điểm Cải Tiến Kỹ Thuật Tại V2.0:
1. **`search_rooms` cấu trúc hóa triệt để**:
   - Tách biệt rõ ràng các mảng: `exact_matches`, `partial_matches`, `alternative_suggestions`, `excluded_candidates`, và `missing_evidence`.
   - Thuộc tính `candidates` tuyệt đối chỉ chứa các phòng đáp ứng đầy đủ tiêu chí bắt buộc (exact matches), không bao giờ trộn lẫn phòng gợi ý thay thế làm sai lệch bối cảnh của Agent.
2. **`quote_price` hỗ trợ mảng phòng (`batch quoting`)**:
   - Chấp nhận tham số `room_ids: string[]` hoặc `room_id: string`, cho phép Agent lấy báo giá đồng thời nhiều ứng viên chỉ trong 1 lần gọi công cụ duy nhất, tiết kiệm độ trễ mạng và token context.
   - Trả về xuất xứ đầy đủ: `quote_id`, `base_price_vnd`, `additional_charges_vnd`, `total_price_vnd`, `price_breakdown_text`, `policy_version: "V1.4.3"`.
3. **`get_room_facts` minh bạch trạng thái**:
   - Trả về rõ ràng: `bathtub_dimension: 'UNKNOWN'`, `has_jacuzzi_jets: 'UNKNOWN'`, `has_pool: 'UNKNOWN'`, `has_sauna: 'UNKNOWN'`, `has_kitchen: 'FALSE'`.
   - Ngăn chặn hoàn toàn việc Agent suy đoán kích thước bồn tắm hoặc chức năng sục bọt.

---

## 5. Quan Sát Động & Minh Chứng Vòng Lặp Suy Luận Đa Lượt

Khác với kiến trúc deterministic workflow tuần tự, Agentic V2.0 thực thi vòng lặp **Bounded Reasoning Loop** (tối đa 3 vòng lặp) với cơ chế quan sát động thực sự:

### Kịch Bản Kiểm Chứng Quan Sát & Tái Lập Kế Hoạch Động:
1. **Khách hỏi mở với ngân sách giới hạn (800.000đ, 4 tiếng chiều thứ 7 tại Hà Đông)**:
   - **Vòng 1 (Khám phá)**: Agent đề xuất gọi `search_rooms` với tiện nghi bồn tắm.
   - **Quan sát 1**: Backend trả về danh sách các phòng có bồn tắm gồm phòng `101-long-chim` và phòng `601-50-sac-thai`.
   - **Vòng 2 (Tính giá)**: Nhận thấy chưa có dữ kiện giá cụ thể, Agent không suy đoán giá mà gọi `quote_price` cho cả 2 phòng trên khung giờ thứ 7 lúc 14:00 nghỉ 4 tiếng.
   - **Quan sát 2**: Backend trả về:
     - Phòng 101: Tổng giá **649.000đ** (449k + 2x100k) $\rightarrow$ Nằm gọn trong ngân sách ($649k \le 800k$).
     - Phòng 601: Tổng giá **849.000đ** (449k + 2x200k) $\rightarrow$ Vượt ngân sách ($849k > 800k$).
   - **Vòng 3 (Đánh giá & Tái lập kế hoạch)**:
     - Agent nhận diện phòng 601 bị vượt ngân sách 49.000đ.
     - Thay vì giấu nhẹm hoặc báo lỗi, Agent chủ động tư vấn phòng 101 là phương án tối ưu trong ngân sách, đồng thời giới thiệu phòng 601 như phương án nâng cấp cao nhất kèm giải thích minh bạch phần chênh lệch giá vượt ngân sách.
   - **Phản hồi**: Câu trả lời tự nhiên, rõ ràng, trung thực, không ảo giác tình trạng phòng trống.

Trace ID mẫu: `live-groq-1795511503859` (minh chứng trong tệp `artifacts/live-traces-v2.json`).

---

## 6. Bộ Giải Ràng Buộc Tổng Quát & Loại Bỏ Hoàn Toàn Hardcode

Tại V2.0, tệp `src/agent/generic-constraint-solver.ts` được thiết kế mới để giải quyết bài toán tư vấn phòng một cách khái quát toán học:

```typescript
export class GenericConstraintSolver {
  public static solve(params: {
    candidatePool: any[];
    quotes: any[];
    maxBudget?: number;
    requiredAmenities: string[];
    softPreferences?: string[];
  }): RecommendationSolveResult;
}
```

### Quy Tắc Xử Lý Động:
1. **Phân nhóm tự động**: Mọi báo giá được phân tích thành `withinBudget` ($total \le budget$) và `overBudget` ($total > budget$).
2. **Xác định phương án chính (`primaryOption`)**:
   - Nếu có phòng trong ngân sách: Chọn phòng phù hợp nhất có giá tốt nhất (`OPTIMAL_WITHIN_BUDGET`).
   - Nếu tất cả phòng đều vượt ngân sách: Chọn phòng có mức vượt thấp nhất (`NEAREST_UPGRADE`) kèm thuộc tính `budgetDeltaVnd` chính xác.
3. **Xác định phương án nâng cấp (`upgradeOption`)**:
   - Lựa chọn phòng cao cấp nhất trong nhóm vượt ngân sách (hoặc phòng hạng cao hơn trong cùng ngân sách).
   - Nêu rõ delta chênh lệch: `vượt ngân sách X đ so với mức Y đ của anh/chị`.
4. **Không ràng buộc mã phòng**: Thuật toán hoạt động độc lập trên mọi tập hợp phòng, áp dụng đồng nhất cho cả Hà Đông, Trần Khát Chân và J Village.

---

## 7. Trạng Thái Có Cấu Trúc & Vòng Đời Bộ Nhớ Động

Lớp `StructuredStateManager` quản lý toàn bộ vòng đời trạng thái của cuộc hội thoại:

### 5 Thao Tác Trạng Thái Bắt Buộc:
1. **Thêm / Cập nhật ràng buộc (`updateConstraint`)**:
   - Cập nhật các trường: `budget`, `durationHours`, `stayType`, `checkinDatetime`, `requiredAmenities`.
   - Tự động gọi `invalidateQuotes` khi các tham số lưu trú cốt lõi thay đổi để tránh sử dụng báo giá cũ.
2. **Rút lại ràng buộc (`retractConstraint`)**:
   - Khi khách nói: *"thôi không cần bồn tắm nữa"*, hệ thống loại bỏ `'bon_tam'` khỏi `requiredAmenities`, xóa bộ lọc cũ và truy vấn lại danh sách phòng tiêu chuẩn.
3. **Từ chối phương án (`rejectChoice`)**:
   - Khi khách nói: *"không lấy phòng 101 nhé"*, mã phòng `101-long-chim` được đưa vào mảng `negatedRoomIds` và `rejectedChoices`. Trong các lượt tiếp theo, phòng này hoàn toàn không xuất hiện trong đề xuất.
4. **Khôi phục lựa chọn (`reinstateChoice`)**:
   - Khi khách đổi ý: *"thôi cho anh lấy lại phòng 101"*, hệ thống rút `101-long-chim` ra khỏi danh sách bị từ chối, đưa vào `reinstatedChoices` và tính toán lại báo giá bình thường.
5. **Vô hiệu hóa báo giá (`invalidateQuotes`)**:
   - Xóa `validQuoteReferences` và ghi nhận bước suy luận `REVISE` trong `decisionSteps`: *"Invalidate old quotes: Constraint X changed"*.

---

## 8. Sẵn Sàng Mở Rộng Đa Cơ Sở & Cô Lập Dữ Liệu

Kiến trúc V2.0 hoàn tất việc trừu tượng hóa đa cơ sở thông qua lớp `JCollectionAgent` (`src/agent/jcollection-agent.ts`):

```typescript
export class JCollectionAgent {
  protected propertyId: CoSoMa;
  protected propertyContext: PropertyContext;
  ...
}

export class HadongAgent extends JCollectionAgent {
  constructor(dataset: NormalizedDataset, options?: AgentOptions) {
    super(dataset, 'jacayl-ha-dong', options);
  }
}
```

### Cơ Chế Cô Lập Cơ Sở (Tenant Isolation):
- Mỗi thực thể Agent được khởi tạo gắn chặt với một mã cơ sở tin cậy (`trustedPropertyId`).
- Tại `ToolGateway`, nếu tham số `property_id` trong yêu cầu gọi công cụ không trùng khớp với `trustedPropertyId`, cổng an ninh lập tức ghi đè hoặc chặn đứng yêu cầu:
  ```typescript
  if (parsed.data.property_id && parsed.data.property_id !== this.trustedPropertyId) {
    throw new Error(`Tenant Isolation Violation: Tool call target ${parsed.data.property_id} is forbidden.`);
  }
  ```
- Thử nghiệm tấn công Cross-Tenant (`Tìm phòng ở j-village bồn tắm dưới 500k` khi đang chat tại Hà Đông) được bảo vệ 100%: Agent giữ nguyên ngữ cảnh Hà Đông và không truy xuất dữ liệu trái phép.

---

## 9. Xác Minh LLM Thực Tế Đa Provider

Để chứng minh hệ thống vận hành bằng mô hình trí tuệ nhân tạo thật, kiểm thử trực tiếp đã được thực thi độc lập với 2 nhà cung cấp miễn phí: **Groq** và **Google Gemini**:

### Tóm Tắt Dấu Vết Thực Thi Thực Tế (`artifacts/live-traces-v2.json`):

#### 1. Phiên Groq (`openai/gpt-oss-20b`):
- **Session ID**: `live-groq-1795511503859`
- **Độ trễ**: 4.066 ms
- **Trạng thái**: `LIVE_LLM_DECISION_VERIFIED`
- **Bước suy luận**:
  - LLM hiểu yêu cầu khách: Bồn tắm, 4 tiếng chiều thứ 7, ngân sách 800k.
  - LLM đề xuất công cụ: `search_rooms(property_id: "jacayl-ha-dong", must_have_amenities: ["bon_tam"])`.
  - Backend thực thi và trả về: Phòng 101 và 601.
  - LLM nhận quan sát, quyết định báo giá và lập luận: Phòng 101 (649k) nằm trong ngân sách; Phòng 601 (849k) vượt ngân sách 49k.
  - Thẩm định phát ngôn: 0 vi phạm, 100% bằng chứng xác thực.

#### 2. Phiên Google Gemini (`gemini-2.5-flash` / `gemini-3.5-flash-lite`):
- **Session ID**: `live-gemini-1795511507925`
- **Độ trễ**: 5.626 ms
- **Trạng thái**: `LIVE_LLM_DECISION_VERIFIED`
- **Bước suy luận**:
  - LLM nhận diện ngân sách 750k, thời lượng 4 tiếng chiều cuối tuần.
  - LLM đề xuất gọi `search_rooms` và `quote_price`.
  - Backend thực thi kiểm tra quyền và tính giá.
  - LLM diễn đạt câu trả lời tự nhiên, tư vấn phòng 101 và minh bạch phòng vượt ngân sách.
  - Thẩm định phát ngôn: 0 vi phạm.

---

## 10. Bộ Kiểm Thử Phát Hiện Lỗi Tự Chủ & Tình Huống Biên

Tệp `tests/agentic-v2-dynamic-observation.test.ts` được thiết kế mới với 6 bài kiểm thử chuyên biệt nhằm phát hiện các tình huống lỗi tự chủ:

1. **Fixture A (Cả 2 ứng viên đều nằm trong ngân sách rộng rãi 1.000.000đ)**:
   - Agent quan sát thấy cả 2 phòng (649k và 849k) đều nhỏ hơn 1.000.000đ.
   - Không xuất hiện bất kỳ câu nào ghi "vượt ngân sách". Phòng 601 được giới thiệu như lựa chọn hạng cao cấp nhất nằm gọn trong ngân sách.
2. **Fixture B (Tất cả ứng viên đều vượt ngân sách thấp 400.000đ cho 4 tiếng)**:
   - Phòng bồn tắm thấp nhất là 101 (649k), vượt 249.000đ.
   - Agent quan sát thấy 100% vượt ngân sách, lập tức tái lập kế hoạch: Nêu rõ phương án gần nhất với ngân sách là phòng 101 kèm con số vượt chính xác `249.000đ`.
3. **Fixture C (Khách hỏi tiện nghi chưa xác nhận: kích thước mét, sục jacuzzi)**:
   - Agent truy vấn `get_room_facts`, nhận trạng thái `UNKNOWN`.
   - Phản hồi xác nhận phòng có bồn tắm lớn, không bịa đặt số đo 1m8 hay sục massage.
4. **Fixture D (Cố tình làm lỗi công cụ tính giá - Tool Gateway Error)**:
   - Giả lập lỗi `Database lock timeout` tại `quote_price`.
   - Agent xử lý ngoại lệ duyên dáng (graceful fallback), không văng lỗi sập ứng dụng (zero crash), phản hồi nhã nhặn hướng dẫn liên hệ lễ tân.
5. **Choice Reinstatement (Từ chối phòng rồi chọn lại)**:
   - Lượt 1: Khách loại trừ phòng 101 $\rightarrow$ Agent không đề xuất 101.
   - Lượt 2: Khách xin xem lại phòng 101 $\rightarrow$ Agent khôi phục phòng 101 vào danh sách và báo giá đầy đủ.
6. **In-flight Takeover Race Condition (Nhân viên tiếp quản khi AI đang suy luận)**:
   - Nhân viên nhấn tiếp quản ngay khi tool đang xử lý ngầm.
   - Chốt chặn Gate 2 trước khi phát tín hiệu bắt được trạng thái `HUMAN_ACTIVE`, lập tức triệt tiêu câu trả lời AI (trả về chuỗi rỗng `""`).

---

## 11. Kết Quả Benchmark & Năng Lực Tổng Quát Hóa

So sánh định lượng tiến trình phát triển qua các mốc:

| Bộ chỉ số đánh giá | M4.3 (Legacy Rule) | Agentic V1.2 | Agentic V1.2.1 | Agentic V2.0 |
| :--- | :---: | :---: | :---: | :---: |
| **Pass Rate 100-Scenario Blind Benchmark** | 94.20% | 98.67% | 100.00% | **100.00%** |
| **Pass Rate 100-Scenario Held-Out Benchmark** | Chưa có | Chưa có | 100.00% | **100.00%** |
| **Pass Rate Dynamic Observation Edge Cases** | Chưa có | Chưa có | Chưa có | **100.00% (6/6)** |
| **Tỷ lệ vi phạm Claim (Ungrounded Claims)** | 4.80% | 0.00% | 0.00% | **0.00%** |
| **Độ chính xác gọi Tool (Tool Discipline)** | Deterministic | 97.50% | 100.00% | **100.00%** |
| **Độ trễ trung bình Fast Path** | < 5 ms | < 5 ms | < 5 ms | **< 3 ms** |
| **Độ trễ trung bình Standard Path** | ~15 ms | ~25 ms | ~25 ms | **~15 ms** |
| **Độ trễ trung bình Deep Path (Local Mock)** | ~35 ms | ~45 ms | ~45 ms | **~25 ms** |
| **Độ trễ trung bình Live LLM (Groq / Gemini)** | N/A | 3.5s - 5.5s | 3.5s - 5.5s | **4.0s - 5.6s** |

---

## 12. Xác Minh Chất Lượng & Kiểm Toán Bất Biến Nghiệp Vụ

Tất cả 4 bất biến cốt lõi của Chủ dự án (Owner Invariants) được bảo đảm tuyệt đối:
1. **Bất biến 1 — Đơn giá phòng 601 cuối tuần**:
   - 2 giờ đầu: **449.000đ** (Concept / Suite cuối tuần).
   - Phụ thu thêm giờ: **200.000đ / giờ**.
   - Nghỉ 4 tiếng chiều thứ 7: $449.000 + 2 \times 200.000 = \mathbf{849.000đ}$.
   - Tuyệt đối không nhầm sang phụ thu 100k của phòng 101 ($649.000đ$).
2. **Bất biến 2 — Bồn tắm và Sục Jacuzzi**:
   - Xác nhận có bồn tắm nằm ngâm thư giãn tại phòng 101 và 601 (nhãn "Bồn tắm lớn").
   - Kích thước mét cụ thể và chức năng sục bọt massage được giữ ở trạng thái `chưa công bố chính thức`.
3. **Bất biến 3 — Quy tắc giờ nhận phòng ban ngày vs buổi tối**:
   - Nhận phòng lúc 17h50 (trước 18:00) $\rightarrow$ Áp dụng biểu giá ban ngày.
   - Nhận phòng lúc 18h10 (sau 18:00) $\rightarrow$ Áp dụng biểu giá buổi tối.
4. **Bất biến 4 — Phòng 401 Hà Đông**:
   - Hoàn toàn loại bỏ khỏi kết quả tìm kiếm và báo giá thương mại (`NOT_FOR_SALE`).

---

## 13. Bảo Vệ Đa Luồng Giao Tiếp Bảng Điều Khiển & Tiếp Quản Người

Hệ thống triển khai cơ chế **Dual-Gate Outbound Safety** để bảo vệ tuyệt đối tính kỷ luật khi tiếp quản:

```
[Khách gửi tin nhắn] ──► GATE 1: Kiểm tra trạng thái phiên tại đầu lượt
                              │
                              ├── Nếu HUMAN_ACTIVE ──────────────► [IM LẶNG TUYỆT ĐỐI (0 AI Outbound)]
                              │
                              └── Nếu AI_ACTIVE ──► [Tiến trình suy luận AI & gọi Tools ngầm]
                                                           │
                                                           ▼
                                                    GATE 2: Kiểm tra chốt chặn trước khi phát tin
                                                           │
                                                           ├── Nếu nhân viên vừa tiếp quản trong lúc chạy
                                                           │   (state.staff_took_over === true)
                                                           │   ──────────────► [HỦY BỎ PHÁT NGÔN (0 AI Outbound)]
                                                           │
                                                           └── Nếu an toàn ──► [Phát phản hồi ra Bảng điều khiển]
```

Xác minh: Bài kiểm thử `In-flight Takeover Race Condition` trong `tests/agentic-v2-dynamic-observation.test.ts` đã chứng minh tính hữu hiệu 100% của Gate 2 khi tiếp quản bất đồng bộ xảy ra.

---

## 14. Kế Hoạch Rollback & Khả Năng Khôi Phục Vận Hành

Hệ thống được bảo vệ bằng cơ chế Feature Flag hai chiều độc lập:
1. **Biến môi trường**: `CONVERSATION_ENGINE=agentic|legacy`.
2. **Khả năng chuyển đổi tức thì**:
   - Nếu phát hiện bất kỳ sự cố nào ở Agentic V2.0, chỉ cần cấu hình `CONVERSATION_ENGINE=legacy` (hoặc xóa biến môi trường).
   - Hệ thống lập tức chuyển về luồng xử lý deterministic M4.3 mà không yêu cầu khởi động lại cơ sở dữ liệu hay sửa mã nguồn.
3. **Bảo toàn dữ liệu**: Dữ liệu phiên chat, lịch sử hội thoại SQLite và thông tin tiếp quản người dùng chung cấu trúc tương thích 100% giữa hai engine.

---

## 15. Phán Quyết Nghiệm Thu & Phạm Vi Giai Đoạn Tiếp Theo

### Phán Quyết: **CONDITIONAL GO**

### Căn Cứ Phê Duyệt:
- Đạt 100% Pass Rate trên 235 bài kiểm thử Agentic cốt lõi (`tests/agentic-*.test.ts`).
- 0 lỗi typecheck TypeScript (`npx tsc --noEmit`).
- Loại bỏ hoàn toàn các cấu trúc hardcode phòng và template ép cứng.
- Đầy đủ dấu vết suy luận thực tế (Live Traces) từ Groq và Gemini.

### Rào Cản & Điều Kiện Bắt Buộc (Conditions):
1. **Phạm vi thử nghiệm**: Chỉ được phép chạy thử nghiệm nội bộ có giám sát tại cơ sở **Jacayl Hotel Hà Đông**.
2. **Nghiêm cấm triển khai toàn chuỗi**: Tuyệt đối không mở rộng sang Jacayl Trần Khát Chân và J Village trước khi tiến hành nghiệm thu độc lập cho từng cơ sở.
3. **Nghiêm cấm kết nối kênh thật**: Không tích hợp PMS hoặc mở cổng khách hàng thật (Fanpage Facebook / Zalo OA) trong cột mốc này.
4. **Chính sách người thứ ba**: Duy trì trạng thái `UNKNOWN` cho phụ thu khách thứ ba cho đến khi chủ dự án ban hành văn bản chính thức.
