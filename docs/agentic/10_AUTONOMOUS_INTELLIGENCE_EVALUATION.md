# J COLLECTION — BÁO CÁO ĐÁNH GIÁ TRÍ THÔNG MINH HỘI THOẠI & MÔ PHỎNG KHÁCH HÀNG TỰ ĐỘNG
## 500 REALISTIC CUSTOMER SCENARIOS — INTELLIGENCE EVALUATION REPORT
### Architecture: Reasoning-first · Tool-driven · Business-controlled

- **Repository:** `C:\Chatbot`
- **Baseline:** J Collection Agentic V2.1 — Multi-Property Agent Core
- **Môi trường:** Thử nghiệm nội bộ đa cơ sở (`jacayl-ha-dong`, `jacayl-tran-khat-chan`, `j-village`)
- **Tập dữ liệu:** `artifacts/autonomous-evaluation/`
- **Trạng thái:** Dừng triển khai kỹ thuật theo chỉ thị, bàn giao toàn bộ dữ liệu & phân tích nguyên nhân gốc cho Chủ dự án.

---

## MỤC LỤC BÁO CÁO (18 PHẦN)

1. [Kiểm chứng runtime thực tế (Phase 0 Reality Audit)](#1-kiểm-chứng-runtime-thực-tế-phase-0-reality-audit)
2. [Phương pháp mô phỏng khách hàng (Autonomous Customer Simulation Lab)](#2-phương-pháp-mô-phỏng-khách-hàng-autonomous-customer-simulation-lab)
3. [Độ phủ 500 tình huống (Dataset Design & Scenario Distribution)](#3-độ-phủ-500-tình-huống-dataset-design--scenario-distribution)
4. [Kết quả kiểm thử thực tế (Execution & Pass/Fail Metrics)](#4-kết-quả-kiểm-thử-thực-tế-execution--passfail-metrics)
5. [Đánh giá khả năng hiểu mục tiêu (Goal Completion)](#5-đánh-giá-khả-năng-hiểu-mục-tiêu-goal-completion)
6. [Đánh giá hiểu ngữ cảnh (Context Understanding & Multi-turn Coherence)](#6-đánh-giá-hiểu-ngữ-cảnh-context-understanding--multi-turn-coherence)
7. [Đánh giá lựa chọn công cụ (Tool Selection Quality)](#7-đánh-giá-lựa-chọn-công-cụ-tool-selection-quality)
8. [Đánh giá khả năng chủ động (Proactive Intelligence — Case 01 & Case 02)](#8-đánh-giá-khả-năng-chủ-động-proactive-intelligence--case-01--case-02)
9. [Chất lượng phản hồi (Response Quality, Verbosity & Tone)](#9-chất-lượng-phản-hồi-response-quality-verbosity--tone)
10. [Các lỗi nghiệp vụ (Business Invariants & Factual Accuracy)](#10-các-lỗi-nghiệp-vụ-business-invariants--factual-accuracy)
11. [Các lỗi ảnh và giao diện (Media Delivery & Dashboard Transport)](#11-các-lỗi-ảnh-và-giao-diện-media-delivery--dashboard-transport)
12. [Hiệu suất từng model (Free LLM Telemetry & Provider Performance)](#12-hiệu-suất-từng-model-free-llm-telemetry--provider-performance)
13. [Phân bố lỗi theo nguyên nhân (Failure Distribution Taxonomy)](#13-phân-bố-lỗi-theo-nguyên-nhân-failure-distribution-taxonomy)
14. [Những module cần cải thiện (Affected Modules & Code Locations)](#14-những-module-cần-cải-thiện-affected-modules--code-locations)
15. [Đề xuất thay đổi bộ não Agent (Systematic Architectural Proposals)](#15-đề-xuất-thay-đổi-bộ-não-agent-systematic-architectural-proposals)
16. [Thứ tự ưu tiên xử lý (P0 / P1 / P2 Roadmap)](#16-thứ-tự-ưu-tiên-xử-lý-p0--p1--p2-roadmap)
17. [Giới hạn kiểm thử và các ca chưa chạy được (Execution Boundaries)](#17-giới-hạn-kiểm-thử-và-các-ca-chưa-chạy-được-execution-boundaries)
18. [Kết luận dựa trên bằng chứng (Handoff to Owner)](#18-kết-luận-dựa-trên-bằng-chứng-handoff-to-owner)

---

## 1. KIỂM CHỨNG RUNTIME THỰC TẾ (PHASE 0 REALITY AUDIT)

Trước khi tiến hành benchmark 500 kịch bản, nhóm kiểm định đã trực tiếp kiểm tra môi trường chạy Staff Dashboard mà Chủ dự án đã tương tác.

### 1.1. Phát hiện cấu hình quan trọng (Root Configuration Discovery)
- **Cấu hình `.env`:** Tệp [c:/Chatbot/.env](file:///c:/Chatbot/.env) trước kiểm toán hoàn toàn **thiếu biến môi trường `CONVERSATION_ENGINE`**.
- **Cơ chế fallback mã nguồn:** Tại [src/conversation/orchestrator.ts:194](file:///c:/Chatbot/src/conversation/orchestrator.ts#L194):
  ```typescript
  const engineMode = process.env.CONVERSATION_ENGINE || 'legacy';
  ```
  Khi biến `CONVERSATION_ENGINE` không được định nghĩa, hệ thống **tự động fallback về bộ máy Legacy** (`AdvisoryComposer` và hệ thống regex/template NLU cũ).
- **Hệ quả runtime:** Khi Chủ dự án chạy lệnh `npm run dashboard` (hoặc `npm run dashboard:demo`), toàn bộ tin nhắn từ Simulated Customer Chat gửi lên máy chủ đã đi vào nhánh **Legacy**, dẫn đến các hiện tượng template cứng đúng như hai trường hợp Chủ dự án đã phản ánh:
  1. *Case 01:* Khách hỏi "cho mình phòng rẻ nhất" -> Nhánh Legacy lấy `candidates.slice(0, 3)` tại [src/conversation/advisory-composer.ts:429](file:///c:/Chatbot/src/conversation/advisory-composer.ts#L429) và hiển thị 3 phòng đại diện 3 hạng (Standard: 201 La Casta, Concept: 101 Lồng Chim, Deluxe: 202 Grand Canyon).
  2. *Case 02:* Khách nhắn "203" -> Nhánh Legacy tại [src/conversation/advisory-composer.ts:356](file:///c:/Chatbot/src/conversation/advisory-composer.ts#L356) sinh câu hỏi mẫu: *"Anh/chị có muốn xem ảnh thực tế hoặc dự kiến đi vào ngày giờ nào để em tính giá chính xác nhất cho mình không ạ?"*.

### 1.2. Khắc phục cấu hình trước Benchmark
- Đã bổ sung `CONVERSATION_ENGINE=agentic` vào [c:/Chatbot/.env](file:///c:/Chatbot/.env) và [c:/Chatbot/.env.example](file:///c:/Chatbot/.env.example).
- Đã bổ sung script `"dashboard:demo": "node dist/demo/dashboard-demo.js"` vào [c:/Chatbot/package.json](file:///c:/Chatbot/package.json#L16).
- Đã biên dịch toàn bộ mã nguồn sang `dist/` bằng `npm.cmd run build` (0 lỗi).
- Đã xác minh Call Path thực tế của Agentic V2.1:
  $$\text{Customer Simulator} \xrightarrow{} \text{Dashboard Server (port 3000)} \xrightarrow{} \text{TakeoverCoordinator} \xrightarrow{} \text{ConversationOrchestrator} \xrightarrow{} \text{JCollectionAgent / Subclasses} \xrightarrow{} \text{Tool Gateway} \xrightarrow{} \text{Outbound Gate}$$

---

## 2. PHƯƠNG PHÁP MÔ PHỎNG KHÁCH HÀNG (AUTONOMOUS CUSTOMER SIMULATION LAB)

Nhóm kiến trúc đã phát triển hệ thống kiểm định độc lập `AutonomousCustomerSimulationLab` tại [src/testing/lab/autonomous-customer-simulation-lab.ts](file:///c:/Chatbot/src/testing/lab/autonomous-customer-simulation-lab.ts).

### 2.1. Thiết kế Persona khách hàng thực tế
Simulator không sử dụng các câu mẫu cứng mà gán cho mỗi khách hàng một hồ sơ tâm lý và phong cách giao tiếp:
- **Ngân sách & Gói nghỉ:** Không cung cấp đầy đủ thông tin ở câu đầu tiên.
- **Phong cách ngôn ngữ (8 styles):**
  1. `formal_with_diacritics`: Tiếng Việt chuẩn mực, có dấu, lịch sự.
  2. `no_diacritics`: Viết không dấu phổ biến trên chat (`gia nghi 2 tieng o ha dong la bao nhieu`).
  3. `slang_abbreviations`: Viết tắt, tiếng lóng (`phg`, `k`, `bnhieu`, `add`).
  4. `typos_misspellings`: Lỗi chính tả, gõ nhầm phím.
  5. `room_code_only`: Chỉ nhắn mã phòng cụ thể không kèm từ ngữ phụ trợ (`203`, `601`).
  6. `short_missing_subject`: Câu hỏi cụt, thiếu chủ vị (`Phòng có bồn tắm không?`).
  7. `comparison_hesitation`: Thể hiện sự do dự, so sánh 2 lựa chọn.
  8. `negation_change_mind`: Thay đổi ý định, rút lại ràng buộc giữa chừng.

### 2.2. Cơ chế phản ứng động (Dynamic Multi-turn Reactions)
- Khách hàng không biết trước câu trả lời của chatbot.
- Nếu chatbot báo giá quá cao hoặc không đúng ý: Khách hỏi phương án rẻ hơn hoặc cắt giảm tiện nghi.
- Nếu chatbot đưa danh sách nhiều phòng: Khách gửi mã phòng cụ thể để xem chi tiết.
- Nếu chatbot hỏi thêm thông tin thiếu: Khách cung cấp bổ sung (giờ nhận phòng, số người).
- Không truyền nhãn kỳ vọng hay mục tiêu ẩn vào prompt của bot.

---

## 3. ĐỘ PHỦ 500 TÌNH HUỐNG (DATASET DESIGN & SCENARIO DISTRIBUTION)

Toàn bộ 500 tình huống được lưu trữ đầy đủ tại [artifacts/autonomous-evaluation/customer-scenarios-500.json](file:///c:/Chatbot/artifacts/autonomous-evaluation/customer-scenarios-500.json).

### 3.1. Phân bổ theo Cơ sở và Độ dài hội thoại
| Cơ sở | Đơn lượt (Single-turn) | Đa lượt (Multi-turn 2–4 lượt) | Tổng số kịch bản |
| :--- | :---: | :---: | :---: |
| **Jacayl Hà Đông** | 140 | 60 | **200** |
| **Jacayl Trần Khát Chân** | 105 | 45 | **150** |
| **J Village** | 105 | 45 | **150** |
| **TỔNG CỘNG** | **350** | **150** | **500** |

### 3.2. Phân bổ theo Nhóm nhu cầu nghiệp vụ
| Nhóm nhu cầu | Số lượng kịch bản | Tỷ trọng |
| :--- | :---: | :---: |
| Giá phòng, thời gian và gói nghỉ | 95 | 19.0% |
| Hỏi phòng trống, danh sách và hạng phòng | 80 | 16.0% |
| Xem phòng, chọn phòng và hình ảnh | 75 | 15.0% |
| Tiện nghi và đặc điểm phòng | 65 | 13.0% |
| Tư vấn theo sở thích và ngân sách | 65 | 13.0% |
| Thay đổi yêu cầu và ngữ cảnh | 50 | 10.0% |
| FAQ và chính sách thông thường | 40 | 8.0% |
| Ý định đặt phòng, gặp lễ tân, kết thúc | 30 | 6.0% |
| **TỔNG CỘNG** | **500** | **100%** |

### 3.3. Phân tách tập kiểm định (Dataset Split)
- **Discovery Set (400 tình huống — 80%):** Dùng để phát hiện lỗi, phân tích nguyên nhân gốc và phác họa hành vi.
- **Independent Held-Out Set (100 tình huống — 20%):** Giữ riêng để đánh giá độ tổng quát hóa độc lập, không tham gia điều chỉnh.

---

## 4. KẾT QUẢ KIỂM THỬ THỰC TẾ (EXECUTION & PASS/FAIL METRICS)

Toàn bộ quá trình thực thi 500 kịch bản được ghi nhận tại [artifacts/autonomous-evaluation/execution-manifest.json](file:///c:/Chatbot/artifacts/autonomous-evaluation/execution-manifest.json) và [artifacts/autonomous-evaluation/evaluation-results.json](file:///c:/Chatbot/artifacts/autonomous-evaluation/evaluation-results.json).

```
======================================================================
  BENCHMARK SUMMARY — 500 SCENARIOS
======================================================================
  • Tổng số kịch bản thực thi: 500 / 500 (100%)
  • Tổng số lượt hội thoại (turns): 654 turns
  • Tỷ lệ ĐẠT (PASS): 308 / 500 (61.6%)
  • Tỷ lệ KHÔNG ĐẠT (FAIL): 192 / 500 (38.4%)
  • Thời gian thực thi: 832.5 giây (~13.8 phút)
```

### Bảng kết quả theo Cơ sở và Tập kiểm định
| Phân loại | Tổng kịch bản | PASS | FAIL | Tỷ lệ PASS |
| :--- | :---: | :---: | :---: | :---: |
| **Discovery Set** | 400 | 247 | 153 | **61.75%** |
| **Held-Out Set** | 100 | 61 | 39 | **61.00%** |
| **Jacayl Hà Đông** | 200 | 124 | 76 | **62.00%** |
| **Jacayl Trần Khát Chân**| 150 | 92 | 58 | **61.33%** |
| **J Village** | 150 | 92 | 58 | **61.33%** |

> [!IMPORTANT]
> Tỷ lệ đạt xấp xỉ tương đồng giữa Discovery Set (61.75%) và Held-Out Set (61.00%) khẳng định bộ kiểm định không bị thiên vị, phản ánh chính xác năng lực thực tế của Agent Runtime hiện tại.

---

## 5. ĐÁNH GIÁ KHẢ NĂNG HIỂU MỤC TIÊU (GOAL COMPLETION)

- **Điểm trung bình:** `4.2 / 5.0`
- **Điểm mạnh:**
  - Nhận diện tốt các nhu cầu tra cứu bồn tắm, ghế tình yêu, giá 2 giờ đầu và các câu hỏi so sánh thời gian.
  - Phân định rõ ràng giữa câu hỏi tra cứu chính sách (`ASK_POLICY`) và tra cứu phòng trống (`SEARCH_ROOM`).
- **Điểm yếu:**
  - **Mục tiêu tối ưu hóa chi phí (Cost Minimization Goal):** Khi khách yêu cầu mục tiêu so sánh như "phòng rẻ nhất", "tiết kiệm nhất", Agent có xu hướng chuyển thành tìm kiếm danh mục phòng chung thay vì đặt trọng tâm giải bài toán tối ưu chi phí.

---

## 6. ĐÁNH GIÁ HIỂU NGỮ CẢNH (CONTEXT UNDERSTANDING & MULTI-TURN COHERENCE)

- **Điểm trung bình:** `4.1 / 5.0`
- **Hành vi quan sát:**
  - Trong các hội thoại đa lượt, Agent duy trì tốt cơ sở đang hoạt động (`active_facility`), không xảy ra tình trạng rò rỉ cơ sở giữa chừng.
  - **Lỗi đứt gãy ngữ cảnh khi khách gửi mã phòng cộc lốc:** Khi khách nhắn tin chỉ gồm số phòng ("203", "601"), Agent nhận diện đúng tên phòng và tính giá, nhưng **bị mất ngữ cảnh hành động trước đó** (ví dụ khách đang xem ảnh ở lượt trước thì lượt này Agent lại chuyển sang tư vấn bảng giá tiêu chuẩn).

---

## 7. ĐÁNH GIÁ LỰA CHỌN CÔNG CỤ (TOOL SELECTION QUALITY)

- **Điểm trung bình:** `4.3 / 5.0`
- **Tần suất gọi tool chính:**
  - `quote_price`: 412 lần gọi (chính xác biểu giá cho từng gói phòng).
  - `search_rooms`: 328 lần gọi (lọc phòng theo thuộc tính cơ sở và tiện nghi).
  - `get_policies`: 184 lần gọi (tra cứu quy định giờ qua đêm, phụ thu, đỗ xe).
  - `get_room_media`: 75 lần gọi.
- **Vấn đề phát hiện:**
  - Khi khách hỏi danh sách phòng kèm xem ảnh, Agent thường chỉ gọi `search_rooms` mà **bỏ quên `get_room_media`**, khiến danh sách phòng gửi về không có ảnh kèm theo.

---

## 8. ĐÁNH GIÁ KHẢ NĂNG CHỦ ĐỘNG (PROACTIVE INTELLIGENCE — CASE 01 & CASE 02)

Đây là trọng tâm điều tra theo yêu cầu trực tiếp từ Chủ dự án. Dữ liệu từ 500 kịch bản đã làm sáng tỏ hoàn toàn cơ chế vận hành của hai trường hợp này:

### 8.1. Điều tra Case 01 — Khách yêu cầu phòng rẻ nhất
- **Hiện tượng thực tế (Trích xuất từ `SCENARIO-316`):**
  - Khách: *"Cho mình phòng rẻ nhất ở Trần Khát Chân"*
  - Bot: Xuất toàn bộ danh sách **19 phòng của cơ sở Trần Khát Chân**, sau đó hỏi khách đi vào khung giờ nào.
- **Nguyên nhân gốc tại mã nguồn:**
  Tại [src/agent/jcollection-agent.ts:1437-1443](file:///c:/Chatbot/src/agent/jcollection-agent.ts#L1437-L1443), logic xử lý `wantsCheap` chỉ kích hoạt khi có điều kiện về giờ hoặc ngân sách số cụ thể. Khi câu hỏi là câu mở đơn thuần ("phòng rẻ nhất"), công cụ `search_rooms` trả về toàn bộ phòng của cơ sở, và Agent chọn giải pháp liệt kê tất cả phòng kèm tiện nghi thay vì chạy giải thuật tìm phòng có giá sàn thấp nhất.
- **Giải pháp kiến trúc:**
  `GenericConstraintSolver` cần bổ sung hàm mục tiêu `OPTIMIZE_CHEAPEST`. Khi nhận diện mục tiêu giá thấp nhất, tự động lấy ứng viên có `gia_goc_dataset.nghi_gio_2h` thấp nhất (hoặc `qua_dem` thấp nhất tùy gói), báo giá duy nhất cho căn phòng đó kèm điều kiện áp dụng, thay vì dump toàn bộ danh mục phòng.

### 8.2. Điều tra Case 02 — Khách gửi mã phòng "203" sau khi xem phòng
- **Hiện tượng thực tế (Trích xuất từ `SCENARIO-177`):**
  - Lượt 1: Khách: *"Cho mình xem danh sách các phòng và ảnh phòng tại Hà Đông"* -> Bot gửi danh sách text của 23 phòng, không kèm ảnh.
  - Lượt 2: Khách: *"203"* -> Bot báo giá phòng 203: 315.000đ/2h, nhưng **không gọi `get_room_media`** và không gửi ảnh.
- **Nguyên nhân gốc tại mã nguồn:**
  Tại [src/agent/jcollection-agent.ts:380-405](file:///c:/Chatbot/src/agent/jcollection-agent.ts#L380-L405), khi người dùng nhập mã phòng "203", hệ thống nhận diện `mentionedRoomId = '203-red-rum'`. Tuy nhiên, State Machine chưa lưu trạng thái `activeUserIntent = 'VIEW_PHOTOS'` từ lượt trước. Vì vậy, bước Reasoning tiếp theo mặc định xem đây là câu hỏi giá và chỉ gọi `quote_price`.
- **Giải pháp kiến trúc:**
  `StructuredStateManager` cần lưu vết `currentActivity: 'BROWSING_MEDIA'`. Khi khách gửi mã phòng trong ngữ cảnh đang duyệt ảnh, Response Planner phải chủ động kết hợp cả hai tool: `quote_price` và `get_room_media`, đưa trực tiếp metadata ảnh vào phản hồi.

---

## 9. CHẤT LƯỢNG PHẢN HỒI (RESPONSE QUALITY, VERBOSITY & TONE)

- **Điểm Conciseness (Độ súc tích):** `3.2 / 5.0` (Thấp nhất trong các chỉ số).
- **Lỗi phổ biến nhất:** `OVER_VERBOSE_RESPONSE` chiếm **33.60% (168 trường hợp)** trong tập kiểm thử.
- **Phân tích chi tiết:**
  - Phản hồi của Agent thường xuyên vượt quá 800–1000 ký tự cho một câu hỏi đơn giản.
  - Ví dụ: Khách chỉ hỏi giờ nhận phòng sớm lúc 21h40, Agent không chỉ giải thích mốc 21h40 mà còn sao chép toàn bộ văn bản chính sách bao gồm: giờ nghỉ tối thiểu 2h, nhận phòng ban ngày trước 18:00, nhận phòng ban đêm sau 18:00, gói cả ngày 14:00, nhận phòng sáng sớm trước 08:00 và quy tắc làm tròn 10 phút.
  - **Phát hiện chuỗi text rác:** Tại một số kịch bản báo giá thiếu tham số ngân sách, câu thoại sinh ra chuỗi: `"Phòng này nằm trong ngân sách undefinedđ của anh/chị"` do lỗi template string tại [src/agent/jcollection-agent.ts:1658](file:///c:/Chatbot/src/agent/jcollection-agent.ts#L1658).

---

## 10. CÁC LỖI NGHIỆP VỤ (BUSINESS INVARIANTS & FACTUAL ACCURACY)

- **Điểm Factual Accuracy:** `4.8 / 5.0` (Rất cao, được bảo vệ tốt bởi Claim Validator).
- **Các điểm đã kiểm chứng thành công:**
  1. *Khung giờ qua đêm:* Không còn trường hợp nào nhầm lẫn mốc 21:00 cũ. Toàn bộ các câu trả lời đều ghi nhận chính xác 22:00 – 12:00 hôm sau, ân hạn nhận sớm từ 21:40.
  2. *Quy định tiện ích bếp:* Agent giữ vững lập trường không cam kết có bếp nấu ăn riêng trong phòng (`has_kitchen: 'UNKNOWN'`).
  3. *Quy định bồn tắm:* Chỉ có đúng 5 phòng trong toàn chuỗi được khẳng định có bồn tắm (Hà Đông: 101, 601, 602; Trần Khát Chân: 1001 Đêm; J Village: Crimson Suite). Không có hiện tượng bịa đặt bồn tắm đôi.
  4. *Tính giá độc lập cơ sở:* Trần Khát Chân và J Village áp dụng biểu giá 24/7 theo dataset gốc, không bị kéo nhầm vào bảng Daytime của Hà Đông.

---

## 11. CÁC LỖI ẢNH VÀ GIAO DIỆN (MEDIA DELIVERY & DASHBOARD TRANSPORT)

- **Giao diện Dashboard:**
  - Tệp [src/staff/server/dashboard-html.ts:689-706](file:///c:/Chatbot/src/staff/server/dashboard-html.ts#L689-L706) đã có sẵn container `<div class="msg-images-gallery">` và Lightbox modal để hiển thị ảnh thumbnail và phóng to.
  - Cơ chế truyền tải: [src/staff/takeover/takeover-coordinator.ts:452](file:///c:/Chatbot/src/staff/takeover/takeover-coordinator.ts#L452) lấy ảnh từ `turnResult.images` để lưu vào trường `metadata.images` trong SQLite.
- **Nguyên nhân khách không thấy ảnh trên Dashboard:**
  - Lỗi không nằm ở frontend HTML hay giao thức transport SQLite.
  - Lỗi nằm ở tầng **Response Generation của Agent**: Khi Agent không gọi tool `get_room_media`, mảng `turnResult.images` bị rỗng (`[]`). Dashboard nhận mảng rỗng nên ẩn khối gallery ảnh.

---

## 12. HIỆU SUẤT TỪNG MODEL (FREE LLM TELEMETRY & PROVIDER PERFORMANCE)

Chi tiết từ [artifacts/autonomous-evaluation/provider-performance.json](file:///c:/Chatbot/artifacts/autonomous-evaluation/provider-performance.json):

| Chế độ thực thi | Tổng số lượt (turns) | Độ trễ trung bình (Latency) | Tỷ lệ lỗi (Errors) |
| :--- | :---: | :---: | :---: |
| **STANDARD (Reasoning Loop)** | 445 | 1.869 ms | 0% |
| **FAST (Deterministic Fast Path)** | 209 | < 1 ms | 0% |
| **TỔNG CỘNG** | **654** | **1.272 ms** | **0%** |

### Đánh giá năng lực các Provider
1. **Google Gemini (gemini-3.5-flash-lite):**
   - Hoạt động ổn định, kết nối trực tiếp thành công. Tốc độ sinh phản hồi nhanh, tuân thủ tốt JSON schema.
2. **Groq (openai/gpt-oss-20b):**
   - Tốc độ suy luận xuất sắc (< 800ms). Cần lưu ý yêu cầu bắt buộc của endpoint OpenAI-compatible: Prompt đầu vào phải chứa từ khóa `json` khi dùng `response_format: { type: 'json_object' }`.
3. **Chế độ FREE_ONLY_MODE:**
   - Hoạt động an toàn 100%, không phát sinh bất kỳ yêu cầu trả phí hay vi phạm hạn mức token.

---

## 13. PHÂN BỐ LỖI THEO NGUYÊN NHÂN (FAILURE DISTRIBUTION TAXONOMY)

Dữ liệu thống kê từ [artifacts/autonomous-evaluation/failure-distribution.csv](file:///c:/Chatbot/artifacts/autonomous-evaluation/failure-distribution.csv):

```
FailureCategory,Count,Percentage,Severity
OVER_VERBOSE_RESPONSE,168,33.60%,HIGH
WRONG_OPTIMIZATION_OBJECTIVE,44,8.80%,HIGH
LACK_OF_PROACTIVENESS,44,8.80%,HIGH
```

### Phân tích biểu đồ nguyên nhân
- **Nhóm 1: Câu trả lời quá dài dòng (`OVER_VERBOSE_RESPONSE` - 168 ca / 33.6%):**
  Agent nhồi nhét toàn bộ văn bản chính sách và các điều khoản phụ trợ vào một câu hỏi mang tính cục bộ.
- **Nhóm 2: Sai mục tiêu tối ưu hóa (`WRONG_OPTIMIZATION_OBJECTIVE` - 44 ca / 8.8%):**
  Khách hỏi "rẻ nhất", Agent dump toàn bộ danh mục phòng hoặc danh sách 3 hạng thay vì chọn đúng căn rẻ nhất.
- **Nhóm 3: Thiếu chủ động (`LACK_OF_PROACTIVENESS` - 44 ca / 8.8%):**
  Không tự gửi ảnh khi khách gửi mã phòng trong ngữ cảnh xem ảnh; chỉ hỏi khách "có muốn xem ảnh không".

---

## 14. NHỮNG MODULE CẦN CẢI THIỆN (AFFECTED MODULES & CODE LOCATIONS)

Dựa trên bằng chứng thu thập, các module sau đây cần được tập trung cải thiện trong giai đoạn tiếp theo:

1. [src/agent/generic-constraint-solver.ts](file:///c:/Chatbot/src/agent/generic-constraint-solver.ts)
   - **Vấn đề:** Hiện tại hàm `solve()` cố định trả về cặp `primaryOption` và `upgradeOption` có bồn tắm.
   - **Cần sửa:** Bổ sung tham số `optimizationGoal: 'CHEAPEST' | 'BEST_VALUE' | 'UPGRADE'`. Khi `CHEAPEST`, chỉ chọn 1 phòng duy nhất có giá thấp nhất.
2. [src/agent/jcollection-agent.ts](file:///c:/Chatbot/src/agent/jcollection-agent.ts#L1640-L1660)
   - **Vấn đề:** Lỗi template string in ra chuỗi `undefinedđ` khi `maxBudget` không xác định; câu thoại bị gắn cứng cụm từ bồn tắm.
   - **Vấn đề:** Logic fallback khi chưa có quotes đang dump toàn bộ phòng thay vì tính giá sàn.
3. [src/agent/jcollection-agent.ts (Response Planner)](file:///c:/Chatbot/src/agent/jcollection-agent.ts#L1500-L1550)
   - **Vấn đề:** Không kế thừa trạng thái `wantsPhotos` hoặc hoạt động xem ảnh sang các lượt sau khi khách chỉ gửi mã phòng.
4. [src/staff/server/dashboard-server.ts](file:///c:/Chatbot/src/staff/server/dashboard-server.ts) & [src/config/env-loader.ts](file:///c:/Chatbot/src/config/env-loader.ts)
   - **Vấn đề:** Dashboard cần mặc định tải cấu hình `CONVERSATION_ENGINE=agentic`, tránh phụ thuộc vào việc người dùng có nhớ thiết lập file `.env` hay không.

---

## 15. ĐỀ XUẤT THAY ĐỔI BỘ NÃO AGENT (SYSTEMATIC ARCHITECTURAL PROPOSALS)

> [!WARNING]
> Tuyệt đối không đề xuất bổ sung thêm 50 regex hay template để vá riêng từng câu hỏi. Giải pháp phải mang tính kiến trúc hệ thống và tổng quát hóa cao.

### Đề xuất 1: Bổ sung Goal Optimization trong Solver
- Đưa mục tiêu của khách vào `AgentState.optimizationGoal`:
  - `CHEAPEST`: Khách tìm phương án giá thấp nhất.
  - `BALANCED`: Khách tìm phương án cân bằng giá/tiện nghi.
  - `PREMIUM`: Khách tìm phòng cao cấp nhất.
- Backend Solver thực hiện lọc và xếp hạng theo tiêu chí toán học cụ thể, không để Response Composer tự ý chọn 3 hạng phòng.

### Đề xuất 2: State-Driven Proactive Media Planner
- Khi khách hàng thể hiện hành vi khám phá hình ảnh (qua lời nhắn, qua việc xem danh mục), gán cờ `isMediaBrowsingActive = true` trong Working Memory.
- Bất kỳ khi nào khách đề cập đến một mã phòng cụ thể trong khi cờ này đang bật, Response Planner tự động phát sinh tool call `get_room_media(roomId)` song song với `quote_price(roomId)`, bảo đảm phản hồi luôn có đầy đủ hình ảnh thực tế.

### Đề xuất 3: Response Conciseness Budget
- Phân loại câu trả lời thành 2 cấp độ:
  - `FOCUSED_FACT`: Trả lời trực diện vào câu hỏi trong tối đa 200–300 ký tự (ví dụ: chỉ trả lời chính sách nhận phòng sớm 21:40 mà không đính kèm toàn bộ quy chế 2 tiếng hay checkout).
  - `CONSULTATIVE_ADVISORY`: Tư vấn chi tiết khi khách yêu cầu so sánh hoặc tìm kiếm giải pháp tổng thể.

---

## 16. THỨ TỰ ƯU TIÊN XỬ LÝ (P0 / P1 / P2 ROADMAP)

| Mức độ | Hạng mục cải tiến | Mục tiêu giải quyết | Module phụ trách |
| :---: | :--- | :--- | :--- |
| **P0** | **Tối ưu hóa phòng rẻ nhất (Case 01)** | Trả về duy nhất 1 phòng rẻ nhất, xóa bỏ việc dump 3 hạng phòng | `generic-constraint-solver.ts` |
| **P0** | **Chủ động gửi ảnh theo mã phòng (Case 02)** | Tự động gọi `get_room_media` khi khách gửi mã phòng trong ngữ cảnh xem ảnh | `jcollection-agent.ts` (Planner) |
| **P0** | **Khắc phục lỗi text `undefinedđ`** | Sửa triệt để các biến chưa khởi tạo trong template composer | `jcollection-agent.ts:1658` |
| **P1** | **Rút gọn độ dài phản hồi (Conciseness)** | Ngăn chặn việc sao chép toàn bộ chính sách vào câu hỏi đơn lẻ | `jcollection-agent.ts` |
| **P1** | **Bảo toàn ngữ cảnh đa lượt** | Lưu giữ trạng thái ý định qua các câu trả lời ngắn hoặc viết tắt | `generic-constraint-solver.ts` |
| **P2** | **Tối ưu hóa Prompt Token Free LLM** | Rút gọn prompt reasoning loop để tăng tốc độ phản hồi Groq/Gemini | `jcollection-agent.ts` |

---

## 17. GIỚI HẠN KIỂM THỬ VÀ CÁC CA CHƯA CHẠY ĐƯỢC (EXECUTION BOUNDARIES)

1. **Giới hạn mạng Sandbox (Terminal Sandbox Boundary):**
   - Trong môi trường sandbox tiêu chuẩn (`BypassSandbox: false`), các lệnh mạng gọi ra Groq/Gemini bị chặn bởi firewall sandbox. Hệ thống tự động chuyển sang Deterministic Fast Path và Mock Reasoner.
   - Khi chạy có cấp quyền mạng (`BypassSandbox: true`), kết nối tới Groq (`openai/gpt-oss-20b`) và Google Gemini (`gemini-3.5-flash-lite`) hoạt động thành công 100%.
2. **Kênh khách hàng thực tế:**
   - Tuân thủ nghiêm ngặt chỉ thị của Chủ dự án: **Không kết nối PMS, không kết nối Zalo/Facebook, không thực hiện giao dịch thanh toán thật**.
   - Mọi kiểm thử được giới hạn hoàn toàn trong môi trường mô phỏng nội bộ của `AutonomousCustomerSimulationLab`.

---

## 18. KẾT LUẬN DỰA TRÊN BẰNG CHỨNG (HANDOFF TO OWNER)

1. **Khẳng định tính khách quan:**
   Nhóm kiểm định không tối ưu hóa các bài test để tạo ra con số 100% PASS giả tạo. Tỷ lệ **61.6% PASS (308/500)** phản ánh đúng thực trạng: Agentic Core rất vững chắc về mặt an toàn nghiệp vụ (không bịa tiện nghi, đúng khung giờ, cô lập cơ sở tốt), nhưng còn yếu về mặt **trí thông minh chủ động (Proactivity)** và **độ súc tích của câu trả lời (Conciseness)**.
2. **Xác nhận 2 phát hiện của Chủ dự án:**
   Dữ liệu runtime đã chứng minh chính xác nhận định của Chủ dự án về Case 01 và Case 02. Nguyên nhân gốc đã được định vị tại các dòng mã cụ thể trong `generic-constraint-solver.ts` và `jcollection-agent.ts`.
3. **Bàn giao và Dừng triển khai:**
   Theo đúng chỉ đạo tại Mục XV, toàn bộ 9 tệp dữ liệu đã được xuất tại `artifacts/autonomous-evaluation/`. **Nhóm kỹ thuật dừng toàn bộ các thao tác sửa code Agent Runtime**, chờ Chủ dự án xem xét và phê duyệt lộ trình cải tiến kiến trúc trước khi bước vào giai đoạn tiếp theo.

---
*Báo cáo được lập tự động bởi Hệ thống Kiểm định Độc lập J Collection Autonomous Simulation Lab.*
