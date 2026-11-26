# J COLLECTION — BUSINESS POLICY ADDENDUM V1.4.5
## BREAKFAST SERVICE & LATE CHECKOUT PRICING
**Ngày hoàn tất:** 2026-11-25  
**Kiến trúc cố định:** `Agentic V3.0 FINAL — Reasoning-first · Tool-driven · Business-controlled` (`CONVERSATION_ENGINE=agentic`, `FREE_ONLY_MODE=true`)  
**Nguồn chính sách:** `OWNER_DIRECT_INSTRUCTION`

---

## 1. BUSINESS POLICY ADDENDUM V1.4.5

Tệp chính sách chính thức mới được lưu tại [j_collection_business_policy_addendum_v1_4_5.json](file:///C:/Chatbot/data/j_collection_business_policy_addendum_v1_4_5.json):

- **Thứ tự ưu tiên & lịch sử phiên bản:**
  - Giữ nguyên nền V1.4.3 ([j_collection_business_policy_v1_4_3.json](file:///C:/Chatbot/data/j_collection_business_policy_v1_4_3.json)) và bản lưu trữ V1.4.4 ([j_collection_business_policy_addendum_v1_4_4.json](file:///C:/Chatbot/data/j_collection_business_policy_addendum_v1_4_4.json)) cũng như toàn bộ canonical room dataset (`data/j_collection_dataset.json`, `data/jacayl-*.json`, `data/j-village.json`).
  - Trong [pricing-policy-loader.ts](file:///C:/Chatbot/src/data-loader/pricing-policy-loader.ts), `loadOwnerPolicyAddendums()` sắp xếp addendum theo version tăng dần (`1.4.4` → `1.4.5`), bảo đảm **V1.4.5 luôn ghi đè V1.4.4** (`supersededVersions: ["1.4.4"]`), không bao giờ để trạng thái `UNKNOWN` từ V1.4.4 đè quyết định `FALSE` của V1.4.5.
  - Telemetry hệ thống ([dashboard-server.ts](file:///C:/Chatbot/src/staff/server/dashboard-server.ts), [dashboard-html.ts](file:///C:/Chatbot/src/staff/server/dashboard-html.ts), [takeover-coordinator.ts](file:///C:/Chatbot/src/staff/takeover/takeover-coordinator.ts), [jcollection-agent.ts](file:///C:/Chatbot/src/agent/jcollection-agent.ts)) công bố `effectivePolicyVersion: "1.4.5"`, `basePolicyVersion: "1.4.3"`, và `activeAddendumId: "J_COLLECTION_OWNER_POLICY_ADDENDUM_V1_4_5"`.

- **Hai quyết định nghiệp vụ chính thức (áp dụng thống nhất cả 3 cơ sở `jacayl-ha-dong`, `jacayl-tran-khat-chan`, `j-village`):**
  1. **Breakfast (`service_available: false`, `separate_service_availability: "FALSE"`, `included_in_room_rate: false`):** Giá phòng không bao gồm bữa sáng; khách sạn không phục vụ bữa sáng và không bán suất sáng riêng. Không hướng dẫn khách gọi lễ tân chỉ để hỏi lại có bữa sáng hay không; không tự suy diễn quy định mang đồ ăn bên ngoài.
  2. **Late Checkout (`applies_to: ["qua_dem", "ngay_dem"]`, `standard_checkout_time: "12:00"`, `grace_period_minutes: 10`):** Trả phòng sau `12:00` trong vòng 10 phút (đến `12:10`) miễn phí (`0đ`); từ phút thứ 11 (`12:11` trở đi) tính giờ phát sinh làm tròn lên từng giờ (`ceil(lateMinutes / 60)`) theo đơn giá riêng của từng phòng (`room.gia_goc_dataset.gio_phat_sinh_ap_dung`: mặc định `100.000đ/giờ`, riêng `601` & `602` Hà Đông `200.000đ/giờ`), giữ chặt composite identity `propertyId::roomId`.

---

## 2. SOURCE DIFF SUMMARY

- **Diff nguồn (`src/`):** `20 files changed, 2848 insertions(+), 550 deletions(-)` đã xuất tại [v1-4-5-policy-diff.diff](file:///C:/Chatbot/artifacts/v1-4-5-policy-diff.diff).
- **Canonical data (`git status --short data/`):** Chỉ bổ sung `data/j_collection_business_policy_addendum_v1_4_4.json` và `data/j_collection_business_policy_addendum_v1_4_5.json`; **0 dòng sửa đổi** trên dataset phòng gốc.
- **Các module chính cập nhật cho V1.4.5:**
  - Policy & Knowledge & Guardrails: [pricing-policy-loader.ts](file:///C:/Chatbot/src/data-loader/pricing-policy-loader.ts), [knowledge-base.ts](file:///C:/Chatbot/src/knowledge/knowledge-base.ts), [claim-validator.ts](file:///C:/Chatbot/src/conversation/grounding/claim-validator.ts).
  - Pricing Engine & Oracle: [quote-types.ts](file:///C:/Chatbot/src/pricing/quote-types.ts) (`calculateLateCheckoutExtension`, `calculateQuote`), [prebooking-quote-engine.ts](file:///C:/Chatbot/src/pricing/prebooking-quote-engine.ts), [automated-pricing-oracle.ts](file:///C:/Chatbot/src/pricing/automated-pricing-oracle.ts).
  - Tool Gateway & Agent Prompt & Telemetry: [agent-tools.ts](file:///C:/Chatbot/src/agent/agent-tools.ts), [jcollection-agent.ts](file:///C:/Chatbot/src/agent/jcollection-agent.ts), [agent-contracts.ts](file:///C:/Chatbot/src/agent/agent-contracts.ts), [takeover-coordinator.ts](file:///C:/Chatbot/src/staff/takeover/takeover-coordinator.ts), [staff-types.ts](file:///C:/Chatbot/src/staff/staff-types.ts), [dashboard-server.ts](file:///C:/Chatbot/src/staff/server/dashboard-server.ts), [dashboard-html.ts](file:///C:/Chatbot/src/staff/server/dashboard-html.ts).

---

## 3. PRICING ENGINE VERIFICATION (CASES A–F)

Toàn bộ các ca nghiệp vụ được kiểm chứng tự động qua `PreBookingQuoteEngine`, `AutomatedPricingOracle`, và `AgentToolGateway.executeTool('quote_price')` trong [v1-4-5-breakfast-and-late-checkout.test.ts](file:///C:/Chatbot/tests/v1-4-5-breakfast-and-late-checkout.test.ts):

| Case | Cơ sở & Phòng | Check-in → Checkout | Gói đủ ĐK | Giá gói | Phát sinh sau 12:00 | Tổng tiền |
| :--- | :--- | :--- | :--- | ---: | ---: | ---: |
| **Case A** | Hà Đông `405-1st-time` | `20:00` → `14:00` hôm sau | `ngay_dem` | `520.000đ` | `2h × 100.000đ = 200.000đ` | **720.000đ** |
| **Case B** | Hà Đông `405-1st-time` | `22:00` → `14:00` hôm sau | `qua_dem` | `420.000đ` | `2h × 100.000đ = 200.000đ` | **620.000đ** |
| **Case C** | Hà Đông `601-50-sac-thai` & `602-playboy` | `20:00` → `14:00` hôm sau | `ngay_dem` | `780.000đ` | `2h × 200.000đ = 400.000đ` | **1.180.000đ** |
| **Case D** | Hà Đông `601-50-sac-thai` | `22:00` → `14:00` hôm sau | `qua_dem` | `700.000đ` | `2h × 200.000đ = 400.000đ` | **1.100.000đ** |
| **Case E** | Hà Đông `405-1st-time` (`100k/h`) | `12:00 / 12:09 / 12:10` | `qua_dem` | `420.000đ` | `0h (ân hạn 10p) = 0đ` | **420.000đ** |
| **Case E** | Hà Đông `405-1st-time` (`100k/h`) | `12:11 / 13:00` | `qua_dem` | `420.000đ` | `1h × 100.000đ = 100.000đ` | **520.000đ** |
| **Case E** | Hà Đông `405-1st-time` (`100k/h`) | `13:01 / 13:10 / 14:00` | `qua_dem` | `420.000đ` | `2h × 100.000đ = 200.000đ` | **620.000đ** |
| **Case E** | Hà Đông `405-1st-time` (`100k/h`) | `14:01` | `qua_dem` | `420.000đ` | `3h × 100.000đ = 300.000đ` | **720.000đ** |
| **Case F1** | Trần Khát Chân `601-golden-inox` | `22:00` → `14:00` hôm sau | `qua_dem` | `1.100.000đ` | `2h × 100.000đ = 200.000đ` | **1.300.000đ** |
| **Case F2** | J Village `601-lagoon` | `20:00` → `14:00` hôm sau | `ngay_dem` | `1.120.000đ` | `2h × 100.000đ = 200.000đ` | **1.320.000đ** |

---

## 4. LIVE CONVERSATION TRANSCRIPTS & 5. ACTUAL TOOL CALLS + QUOTE RESULTS

Kịch bản hội thoại tự nhiên chưa từng xuất hiện trong ví dụ ([live-v1-4-5-verify.ts](file:///C:/Chatbot/scripts/live-v1-4-5-verify.ts) → [live-v1-4-5-verification.json](file:///C:/Chatbot/artifacts/live-v1-4-5-verification.json)) chạy với `STRICT_LIVE_ONLY=true`, `FREE_ONLY_MODE=true` đạt **6/6 lượt `LIVE_LLM_DECISION_VERIFIED`** (0 deterministic fallback):

### Chuỗi 3 lượt đổi giờ liên tiếp (Hà Đông 405, clock `20:10+07:00`)
- **Turn 1 (`V145_MT1_405_2030_TO_1400`)**
  - Khách: *"Phòng 405 bên Hà Đông nếu tầm 8 rưỡi tối nay anh mới tới, định ngủ lại tới 2 giờ chiều hôm sau thì hết tổng cộng bao nhiêu tiền?"*
  - Provider: `groq: qwen/qwen3.8-27b` (`LIVE_LLM_DECISION_VERIFIED`, `effectivePolicyVersion: "1.4.5"`)
  - Actual tool calls: `quote_price(room_id="405", checkin_datetime="2026-11-25T20:30:00+07:00", checkout_datetime="2026-11-26T14:00:00+07:00")`
  - Quote result: `stay_type: "ngay_dem"`, `base_package_price_vnd: 520000`, `actual_late_checkout_minutes: 120`, `billable_extra_hours: 2`, `extra_hour_rate_vnd: 100000`, `extra_hour_subtotal_vnd: 200000`, `total_price_vnd: 720000`
  - AI trả lời tổng trước (**720.000đ**), tách rõ `520.000đ` Ngày Đêm + `200.000đ` trả muộn 2h và nêu rõ chưa xác nhận phòng trống/khả năng kéo dài nếu chưa kiểm tra PMS.

- **Turn 2 (`V145_MT2_405_SHIFT_CHECKIN_2230_KEEP_1400`)**
  - Khách: *"À nếu anh cố thu xếp qua trễ hẳn lúc 10 giờ rưỡi tối thì bớt được nhiều không?"*
  - Actual tool calls: Model tự giữ nguyên `checkout_datetime: "2026-11-26T14:00:00+07:00"` và cập nhật `checkin_datetime: "2026-11-25T22:30:00+07:00"` gửi vào `quote_price`.
  - Quote result: `stay_type: "qua_dem"`, `base_package_price_vnd: 420000`, `billable_extra_hours: 2`, `extra_hour_subtotal_vnd: 200000`, `total_price_vnd: 620000`.
  - AI trả lời tổng **620.000đ**, tiết kiệm được **100.000đ** so với lịch 20:30.

- **Turn 3 (`V145_MT3_405_SHIFT_CHECKOUT_1208_GRACE`)**
  - Khách: *"Thế sáng hôm sau tầm 12h08 anh mới trả phòng thì có bị tính thêm tiền tiếng nào không em?"*
  - Provider: `gemini: gemini-3.1-flash-lite` (`LIVE_LLM_DECISION_VERIFIED`)
  - AI trả lời đúng chính sách ân hạn 10 phút sau `12:00` (`12:08` nằm trong khung miễn phí, không tính thêm phí).

### Kiểm chứng đơn giá riêng 200k/h & làm tròn 14:15 + cô lập 3 cơ sở + bữa sáng `FALSE`
- **Hà Đông `601` (`V145_HD_601_2200_TO_1415`):**
  - Khách: *"Cho anh hỏi căn 50 Sắc Thái nếu 10h tối nay nhận phòng và tới 2h15 chiều mai mới trả thì tổng chi phí tính thế nào?"*
  - Tool calls: `search_rooms(category="Concept")` → `quote_price(room_id="601-50-sac-thai", stay_type="qua_dem", checkin_datetime="2026-11-25T22:00:00+07:00", checkout_datetime="2026-11-26T14:15:00+07:00")`
  - Quote result: `actual_late_checkout_minutes: 135`, `billable_extra_hours: 3`, `extra_hour_rate_vnd: 200000`, `extra_hour_subtotal_vnd: 600000`, `base_package_price_vnd: 700000`, `total_price_vnd: 1300000`.
  - AI trả lời: **1.300.000đ** (`700.000đ` + 3h phát sinh × `200.000đ` = `600.000đ`), kèm lưu ý không tự xác nhận PMS.
- **Trần Khát Chân `202` (`V145_TKC_202_BREAKFAST_FALSE`):**
  - Khách hỏi ăn sáng miễn phí / mua thêm suất sáng → AI (`groq: qwen/qwen3.8-27b`) trả lời thẳng: tất cả hạng phòng và gói nghỉ không bao gồm bữa sáng, khách sạn không phục vụ bữa sáng và không bán suất sáng riêng (không đùn đẩy sang lễ tân xác minh bữa sáng, không bịa lệnh cấm mang đồ ăn ngoài).
- **J Village `601-lagoon` (`V145_JV_601_LATE_AND_BREAKFAST`):**
  - Tool calls: `quote_price(property_id="j-village", room_id="601-lagoon", checkin="22:00", checkout="14:00")` + `get_policies(topic="breakfast")`.
  - Quote result: `base_package_price_vnd: 719000`, `extra_hour_rate_vnd: 100000` (cô lập hoàn toàn khỏi mức `200k` của 601 Hà Đông), `billable_extra_hours: 2`, `extra_hour_subtotal_vnd: 200000`, `total_price_vnd: 919000`.
  - AI trả lời: **919.000đ** (`719.000đ` + `200.000đ`) và J Village không phục vụ bữa sáng, không bán suất sáng riêng.

---

## 6. REGRESSION RESULTS

- **Biên dịch (`npm.cmd run build`):** `tsc` thoát mã `0` sau chỉnh sửa cuối cùng.
- **Bộ test offline (sandboxed Vitest):** **54 / 54 files PASS, 720 / 720 tests PASS** (gồm toàn bộ 715 test trước đó và 5 test mới trong [v1-4-5-breakfast-and-late-checkout.test.ts](file:///C:/Chatbot/tests/v1-4-5-breakfast-and-late-checkout.test.ts), cùng [v3-final-temporal-media-breakfast.test.ts](file:///C:/Chatbot/tests/v3-final-temporal-media-breakfast.test.ts) đã đồng bộ kỳ vọng V1.4.5).
- **HTTP RBAC & Invariants ([m4-invariants-regression.test.ts](file:///C:/Chatbot/tests/m4-invariants-regression.test.ts)):** **1 / 1 file PASS, 7 / 7 tests PASS**.
  → **Tổng offline + HTTP RBAC:** **55 / 55 files, 727 / 727 tests PASS**.
- **Playwright E2E 3 cơ sở ([agentic-v3-final-3property-e2e.test.ts](file:///C:/Chatbot/tests/e2e/agentic-v3-final-3property-e2e.test.ts)):** Trong 2 lần chạy sau chỉnh sửa V1.4.5 với `FREE_ONLY_MODE=true`, lần 2 hoàn tất cả 4 bước tại Hà Đông (`hdAi1`, `hdAi2` ảnh + giá, `hdAi3` đổi sang Standard 201, Human Takeover chặn AI) nhưng bị timeout `30000ms` ở lượt Trần Khát Chân `tkcAi` (dòng 166) do độ trễ failover từ API miễn phí (`gemini` HTTP 503 trong cùng ngày đạt 6/13 lỗi 503 ở run live trước đó). Không nới lỏng timeout/assertion của test.

---

## 7. HƯỚNG DẪN CẬP NHẬT STAFF DASHBOARD

1. Dừng tiến trình Staff Dashboard cũ đang giữ cổng `3000` (nếu có).
2. Biên dịch bản mới và khởi chạy lại từ `dist/`:
   ```powershell
   npm.cmd run build
   node dist/demo/dashboard-demo.js
   ```
3. Mở `http://127.0.0.1:3000/`, đăng nhập tài khoản quản trị/lễ tân và bấm **LLM Telemetry**: xác minh trường **Policy** hiển thị `V1.4.5` (từ `/api/telemetry`: `effectivePolicyVersion: "1.4.5"`, `basePolicyVersion: "1.4.3"`, `activeAddendumId: "J_COLLECTION_OWNER_POLICY_ADDENDUM_V1_4_5"`).
4. Thử nhanh tại khung giả lập khách hàng:
   - Hỏi bữa sáng tại bất kỳ cơ sở nào → AI xác nhận không phục vụ/không bán suất sáng riêng.
   - Hỏi nhận phòng `20:30` tối nay trả `14:00` chiều mai cho phòng `405` → AI báo tổng `720.000đ` (`520k + 200k`), đổi sang `22:30` → AI cập nhật `620.000đ`.

---

## 8. CÁC GIỚI HẠN CÒN TỒN TẠI

1. **Chưa kết nối PMS thời gian thực:** Báo giá kéo dài giờ trả phòng sau `12:00` chỉ tính toán biểu phí tham khảo theo V1.4.5, không mặc định xác nhận còn phòng trống hoặc phòng không có khách kế tiếp đặt lúc `14:00` (luôn yêu cầu đối soát lễ tân thực tế).
2. **Độ ổn định API miễn phí (`FREE_ONLY_MODE=true`):** Gemini Free Tier ghi nhận tỷ lệ HTTP 503 cao theo đợt, đôi khi khiến lượt hội thoại cần failover mất >30 giây (gây timeout ở bài E2E dùng ngưỡng chờ cố định 30s trên trình duyệt).
3. **Turn phụ hỏi riêng giờ trả phòng trong ân hạn (`V145_MT3_405_SHIFT_CHECKOUT_1208_GRACE`):** Model trả lời đúng chính sách ân hạn miễn phí ở `12:08`, tuy nhiên không phải lượt nào model cũng chủ động gọi lại `quote_price` nếu khách chỉ hỏi dạng yes/no ("có bị tính thêm tiền không").
