# J COLLECTION — V3.0 FINAL
## BUSINESS KNOWLEDGE · TEMPORAL INTELLIGENCE · ROOM MEDIA PRESENTATION
**Ngày hoàn tất:** 2026-11-25  
**Baseline:** `3.0.0-llm-native-final`  
**Kiến trúc cố định:** `Reasoning-first · Tool-driven · Business-controlled` (`CONVERSATION_ENGINE=agentic`, `FREE_ONLY_MODE=true`)

---

## I. TÓM TẮT ĐIỀU HÀNH

Bản nâng cấp này xử lý triệt để ba nhóm lỗi thực tế được Chủ dự án phát hiện khi kiểm thử trực tiếp trên Staff Dashboard, mà **không** thêm Intent Router, Cognitive Planner, Temporal Keyword Detector, Response Template hay regex/if-else phân loại câu hỏi:

1. **Kiến thức nghiệp vụ về bữa sáng:** Bổ sung addendum chính thức của Chủ dự án khẳng định giá phòng tại cả 3 cơ sở (`jacayl-ha-dong`, `jacayl-tran-khat-chan`, `j-village`), mọi hạng phòng và mọi gói nghỉ đều **không bao gồm bữa sáng**; dịch vụ phục vụ bữa sáng riêng mang trạng thái `UNKNOWN` (không suy đoán "có" hay "hoàn toàn không bán riêng", hướng dẫn liên hệ lễ tân khi cần).
2. **Năng lực hiểu thời gian theo ngữ cảnh & tư vấn gói nghỉ:** Truyền đồng hồ thực tế theo múi giờ Việt Nam (`Asia/Ho_Chi_Minh`) vào Runtime & System Prompt, loại bỏ việc ghi đè thời gian bằng regex trước khi Live LLM suy luận, đồng thời tích hợp `StayPackageEligibilityResolver` trực tiếp vào công cụ `quote_price`.
3. **Trình bày album ảnh tách theo từng phòng & tối ưu hội thoại tự nhiên:** Mở rộng contract end-to-end từ `get_room_media` → `JCollectionAgent` → `TakeoverCoordinator` → `SqliteStore` → `DashboardServer` → `dashboard-html.ts` để hiển thị album riêng theo đúng thứ tự phòng xuất hiện trong câu trả lời và cô lập Lightbox theo từng phòng.

> [!NOTE]
> Toàn bộ dữ liệu gốc trong `data/j_collection_dataset.json`, `data/jacayl-*.json`, `data/j-village.json` và `data/j_collection_business_policy_v1_4_3.json` được **giữ nguyên tuyệt đối** (`git status --short data/` chỉ ghi nhận thêm tệp addendum mới `data/j_collection_business_policy_addendum_v1_4_4.json`).

---

## II. ĐIỀU TRA PHÁP Y PHIÊN KIỂM THỬ CHỦ DỰ ÁN (`sim_1795601851439`)

Từ `data/staff_dashboard.db`, các lượt lỗi gốc được truy vết chi tiết:

| Lượt / Trace ID | Tin nhắn khách | Nguyên nhân gốc rễ (Root Cause) | Khắc phục kiến trúc |
| :--- | :--- | :--- | :--- |
| Turn 6 (`tr_sim_1795601851439_t6_mwvz59p6`) | Gửi ảnh nhiều phòng | `jcollection-agent.ts` gộp phẳng `deliveredImages.push(...res.data.images)`, làm mất `roomId`/`roomName`; `dashboard-html.ts` rơi về nhãn `"Ảnh phòng"` trong một lưới phẳng duy nhất. | Chuẩn hóa `RoomPresentationBlock[]` + `lastPresentedRooms`; tách `.room-album-block` theo phòng và cô lập Lightbox theo album. |
| Turn 7–8 (`tr_sim_1795601851439_t8_mwvz7c8x`) | `nếu 7h anh đến ở qua đêm...` / `19h anh đến` lúc 17:22 | (1) `JCollectionAgent` dùng đồng hồ mặc định cứng `'2026-11-28T14:00:00+07:00'`, Dashboard không truyền server wall-clock; (2) heuristic regex trước LLM ép `"7h"` → `07:00` (`hour_confirmed=true`); (3) `quote_price` gọi `PreBookingQuoteEngine.getQuote` mà không chạy `StayPackageEligibilityResolver`, nên trả `420.000đ` (`qua_dem`) cho giờ nhận `19:00`. | Truyền `Asia/Ho_Chi_Minh` wall-clock + `Temporal Context`; bỏ qua regex temporal trước LLM khi `isRealLLM === true`; nhúng `StayPackageEligibilityResolver` vào `quote_price`. |
| Turn 9 | Hỏi bữa sáng | Thiếu dữ kiện nghiệp vụ về bữa sáng trong Knowledge Base & Claim Validator. | Bổ sung `j_collection_business_policy_addendum_v1_4_4.json`, `POLICY_BREAKFAST`, `get_policies(breakfast)` và `ClaimValidator` rule 8.4. |

---

## III. CHI TIẾT TRIỂN KHAI THEO 3 NĂNG LỰC

### 1. Kiến thức nghiệp vụ về bữa sáng (`v1.4.4 Addendum`)
- **Tệp dữ liệu mới:** [j_collection_business_policy_addendum_v1_4_4.json](file:///C:/Chatbot/data/j_collection_business_policy_addendum_v1_4_4.json) (`source_type: "OWNER_DIRECT_INSTRUCTION"`, `included_in_room_rate: false`, `separate_service_availability: "UNKNOWN"`). Tệp cấu hình gốc `1.4.3` (`J_COLLECTION_BUSINESS_POLICY_V1_4_3`) giữ nguyên `schema_version: "1.4.3"` để bảo toàn tương thích ngược với `tests/policy-consistency.test.ts` và `tests/pricing-policy-loader.test.ts`.
- **Loader & Knowledge Base:** [pricing-policy-loader.ts](file:///C:/Chatbot/src/data-loader/pricing-policy-loader.ts) bổ sung `BreakfastAddendumSchema`, `OwnerPolicyAddendumSchema`, `loadOwnerPolicyAddendums()`. [knowledge-base.ts](file:///C:/Chatbot/src/knowledge/knowledge-base.ts) thêm mục `POLICY_BREAKFAST`.
- **Tool & Guardrail:** [agent-tools.ts](file:///C:/Chatbot/src/agent/agent-tools.ts) bổ sung topic `breakfast` cho `get_policies`. [claim-validator.ts](file:///C:/Chatbot/src/conversation/grounding/claim-validator.ts) bổ sung mục `8.4. Breakfast Policy Addendum Validation` chặn phát ngôn sai sự thật ("bao gồm ăn sáng miễn phí" hoặc khẳng định chắc chắn bán/không bán dịch vụ riêng).

### 2. Năng lực hiểu thời gian theo ngữ cảnh & Tư vấn gói nghỉ
- **Server Clock (`Asia/Ho_Chi_Minh`):** [checkin-pricing-resolver.ts](file:///C:/Chatbot/src/pricing/checkin-pricing-resolver.ts) thêm `getVietnamTemporalContext()` trả về `localDate`, `localTime`, `dayOfWeekVi`, `isWeekend`. [orchestrator.ts](file:///C:/Chatbot/src/conversation/orchestrator.ts), [takeover-coordinator.ts](file:///C:/Chatbot/src/staff/takeover/takeover-coordinator.ts) và [dashboard-server.ts](file:///C:/Chatbot/src/staff/server/dashboard-server.ts) truyền đồng bộ `messageTimestamp` và `referenceClock`.
- **Bảo toàn Cognitive Authority cho Live LLM:** [jcollection-agent.ts](file:///C:/Chatbot/src/agent/jcollection-agent.ts) bỏ mặc định đồng hồ tĩnh, truyền `Temporal Context` đầy đủ vào `buildLLMReasoningPrompt`, bỏ qua bước regex heuristic thời gian trước LLM khi `isRealLLM === true` (đồng thời sửa lỗi ranh giới từ JS `\b` với chuỗi `"7 hết"` bằng `(?=$|\s|\d|[,.;:!?])`).
- **Eligibility Engine trong Tool:** [agent-tools.ts](file:///C:/Chatbot/src/agent/agent-tools.ts) mở rộng `QuotePriceArgsSchema` thêm `stay_intent`, `checkout_datetime`, `checkin_confidence` và gọi `StayPackageEligibilityResolver` ngay trong `quote_price`, trả về `requested_package`, `recommended_package`, `eligible_packages`, `ineligible_packages`, `applicable_window`, `business_reason`, và `unconfirmed_conditions`.

### 3. Trình bày Album Ảnh Theo Từng Phòng & Trải Nghiệm Tư Vấn Tự Nhiên
- **Data Contract & Persistence:** [agent-contracts.ts](file:///C:/Chatbot/src/agent/agent-contracts.ts) định nghĩa `RoomPresentationImage`, `RoomPresentationBlock` (`order?: number` tương thích dữ liệu cũ) và `AgentState.lastPresentedRooms`; mở rộng `room_presentations` ([conversation-types.ts](file:///C:/Chatbot/src/conversation/conversation-types.ts)) và `roomPresentations` ([staff-types.ts](file:///C:/Chatbot/src/staff/staff-types.ts)) lưu trữ bền vững trong SQLite (`SqliteStore`).
- **Response-Order Alignment & Slug Hygiene:** [agent-tools.ts](file:///C:/Chatbot/src/agent/agent-tools.ts) bổ sung `property_id`, `room_id`, `room_code`, `room_name`, `order`, `caption` cho `get_room_media`. [jcollection-agent.ts](file:///C:/Chatbot/src/agent/jcollection-agent.ts) loại URL ảnh thô khỏi observation/câu trả lời, căn chỉnh `orderedRoomPresentations` theo đúng thứ tự phòng xuất hiện trong phản hồi AI, lưu `lastPresentedRooms` cho tham chiếu ngữ cảnh (`"căn thứ hai"`), và hướng dẫn tra `search_rooms` trước để lấy đúng slug phòng.
- **Dashboard Album UI & Album-Scoped Lightbox:** [dashboard-html.ts](file:///C:/Chatbot/src/staff/server/dashboard-html.ts) hiển thị từng `.room-album-block` (tiêu đề `roomName`, số lượng ảnh, lưới `.gallery-card` riêng), cô lập Lightbox (`#lightbox-room-title`, `#lightbox-prev`, `#lightbox-next`, `#lightbox-counter`, phím mũi tên/Escape) trong phạm vi từng album, đồng thời giữ fallback tương thích ngược cho tin nhắn ảnh cũ chưa gắn `roomPresentations` mà không gán nhầm tên phòng.

---

## IV. BẰNG CHỨNG UI & KIỂM THỬ THỰC TẾ (LIVE LLM + PLAYWRIGHT)

Bằng chứng chụp màn hình trên phiên `owner_replay_v3_final`:
- Album nhiều phòng tách khối (`505 — Koi Room` 3 ảnh, `501 — Hentai Room` 4 ảnh, `405 — 1st Time` 3 ảnh) theo đúng thứ tự câu trả lời và giữ nguyên sau `page.reload()`: [v3-final-room-albums-dashboard.png](file:///C:/Chatbot/artifacts/screenshots/v3-final-room-albums-dashboard.png)
- Lightbox cô lập trong album `501 — Hentai Room` (`1 / 4` → `4 / 4`, `Sau >` bị vô hiệu hóa ở `4 / 4`): [v3-final-room-album-lightbox.png](file:///C:/Chatbot/artifacts/screenshots/v3-final-room-album-lightbox.png)

Chi tiết **12/12 kịch bản Live LLM** ([live-temporal-media-verification.json](file:///C:/Chatbot/artifacts/live-temporal-media-verification.json), `strict_live_only: true`, `free_only_mode: true`):

| Kịch bản | Provider / Model | Trạng thái | Kết quả xác minh chính |
| :--- | :--- | :--- | :--- |
| `OWNER_REPLAY_0_STANDARD_LIST` | `groq: qwen/qwen3.8-27b` | `LIVE_LLM_DECISION_VERIFIED` | Liệt kê đủ 6 phòng Standard Hà Đông (`201..505`), giá từ `159.000đ`/`420.000đ`. |
| `OWNER_REPLAY_1_MEDIA_505_501_405` | `gemini: gemini-3.5-flash-lite` | `LIVE_LLM_DECISION_VERIFIED` | Tách đúng 3 album theo thứ tự `505` (3 ảnh), `501` (4 ảnh), `405` (3 ảnh). |
| `OWNER_REPLAY_2_1722_7H_OVERNIGHT` | `gemini: gemini-3.5-flash-lite` | `LIVE_LLM_DECISION_VERIFIED` | Tại `17:22`, `"7h anh đến ở qua đêm"` suy luận đúng **19:00** → gói **Ngày Đêm `520.000đ`** (không báo nhầm `420.000đ`). |
| `OWNER_REPLAY_3_19H_CLARIFY` | `gemini: gemini-3.5-flash-lite` | `LIVE_LLM_DECISION_VERIFIED` | `"19h anh đến"` giữ nguyên mạch 3 phòng và gói Ngày Đêm **`520.000đ`**. |
| `OWNER_REPLAY_4_BREAKFAST` | `gemini: gemini-3.5-flash-lite` | `LIVE_LLM_DECISION_VERIFIED` | Khẳng định không bao gồm bữa sáng; dịch vụ riêng chưa có thông tin (`UNKNOWN`), dẫn hotline `0522 464 646`. |
| `GEN_06_07_CONTEXTUAL_SECOND_AND_PHOTO_ONLY` | `gemini: gemini-3.5-flash-lite` | `LIVE_LLM_DECISION_VERIFIED` | Hiểu `"căn thứ hai vừa gửi"` là **501 — Hentai Room** (`159.000đ`/2h) và chỉ gửi lại album `405` (3 ảnh). |
| `GEN_01_7H_TOMORROW_MORNING` | `gemini: gemini-3.5-flash-lite` | `LIVE_LLM_DECISION_VERIFIED` | `"7h sáng mai... 2 tiếng"` phòng 201 hiểu đúng 07:00 sáng → **`159.000đ`**. |
| `GEN_03_CHANGE_19H_TO_22H` | `gemini: gemini-3.5-flash-lite` | `LIVE_LLM_DECISION_VERIFIED` | Đổi từ 19h sang **22h tối nay** qua đêm phòng 405 → **`420.000đ`** (`22:00–12:00`). |
| `GEN_01B_LAT_NUA_RELATIVE` | `groq: qwen/qwen3.8-27b` | `LIVE_LLM_DECISION_VERIFIED` | Tại `17:30`, hiểu `"lát nữa"` là trước `21:40`, giải thích mốc `21:40`/`22:00` (`420.000đ`) vs Ngày Đêm và hỏi giờ đến cụ thể. |
| `GEN_02_10_GRACE_2140_AND_2000` | `gemini: gemini-3.5-flash-lite` | `LIVE_LLM_DECISION_VERIFIED` | Phân biệt rõ **`20:00` → Ngày Đêm `520.000đ`** và **`21:40` → Qua Đêm `420.000đ`** (ân hạn 20 phút). |
| `GEN_08_TKC_202_BREAKFAST` | `gemini: gemini-3.5-flash-lite` | `LIVE_LLM_DECISION_VERIFIED` | Trần Khát Chân P.202 Walnut qua đêm **`1.000.000đ`**, không kèm bữa sáng, hotline `0921 123 939`. |
| `GEN_08_JV_202_BREAKFAST` | `groq: qwen/qwen3.8-27b` | `LIVE_LLM_DECISION_VERIFIED` | J Village P.202 Neon (Superior) qua đêm **`639.000đ`**, không kèm bữa sáng, hotline `0707 646 464`. |

---

## V. KẾT QUẢ HỒI QUY & BẰNG CHỨNG DIFF

- **Diff nguồn (`src/`):** `17 files changed, 2237 insertions(+), 531 deletions(-)` đã xuất ra [v3-final-pilot-diff.diff](file:///C:/Chatbot/artifacts/v3-final-pilot-diff.diff).
- **Biên dịch (`npm.cmd run build`):** `tsc` thoát mã `0` sau chỉnh sửa `src/` cuối cùng.
- **Bộ test offline (sandboxed Vitest):** **53 / 53 test files PASS, 715 / 715 tests PASS** (gồm 5 unit tests mới trong [v3-final-temporal-media-breakfast.test.ts](file:///C:/Chatbot/tests/v3-final-temporal-media-breakfast.test.ts) kiểm tra addendum bữa sáng, ClaimValidator, đồng hồ `Asia/Ho_Chi_Minh`, `quote_price` eligibility cho `19:00`/`21:40`/`07:00`, và lưu trữ `roomPresentations` trong SQLite).
- **HTTP RBAC & Invariants ([m4-invariants-regression.test.ts](file:///C:/Chatbot/tests/m4-invariants-regression.test.ts)):** **1 / 1 file PASS, 7 / 7 tests PASS**.
  → **Tổng hợp offline + HTTP RBAC:** **54 / 54 files, 722 / 722 tests PASS**.
- **E2E Playwright 3 cơ sở ([agentic-v3-final-3property-e2e.test.ts](file:///C:/Chatbot/tests/e2e/agentic-v3-final-3property-e2e.test.ts)):** **1 / 1 test PASS** (`106.51s`, `106514ms`).

---

## VI. CÂU HỎI NGHIỆP VỤ CÒN MỞ CHO CHỦ DỰ ÁN

1. **Dịch vụ ăn sáng riêng ngoài giá phòng (`separate_service_availability: "UNKNOWN"`):** Cơ sở có bán suất sáng riêng / đặt hộ đồ ăn sáng có tính phí hay không, giá bao nhiêu và phục vụ theo khung giờ nào? Khi có xác nhận chính thức, chỉ cần cập nhật trường `breakfast` trong [j_collection_business_policy_addendum_v1_4_4.json](file:///C:/Chatbot/data/j_collection_business_policy_addendum_v1_4_4.json) mà không cần sửa code.
2. **Khung lưu trú đặc biệt như `"20h tối nay đến 14h chiều mai"`:** Hiện gói `ngay_dem` kết thúc tiêu chuẩn lúc `12:00` trưa hôm sau; việc trả muộn đến `14:00` áp dụng phụ thu thêm giờ chuẩn hay gói thương lượng riêng cần Chủ dự án chốt chính sách để đưa vào `Pricing Engine`.
