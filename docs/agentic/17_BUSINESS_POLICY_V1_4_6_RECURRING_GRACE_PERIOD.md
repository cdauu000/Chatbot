# J COLLECTION — BUSINESS POLICY ADDENDUM V1.4.6
## RECURRING 10-MINUTE GRACE PERIOD
**Ngày hoàn tất:** 2026-11-25  
**Kiến trúc cố định:** `Agentic V3.0 FINAL — Reasoning-first · Tool-driven · Business-controlled` (`CONVERSATION_ENGINE=agentic`, `FREE_ONLY_MODE=true`)  
**Chính sách nền:** V1.4.3 (`basePolicyVersion: "1.4.3"`) → V1.4.4 → V1.4.5 → **Effective V1.4.6** (`OWNER_DIRECT_INSTRUCTION`)

---

## 1. BUSINESS POLICY ADDENDUM V1.4.6

Tệp chính sách chính thức mới được lưu tại [j_collection_business_policy_addendum_v1_4_6.json](file:///C:/Chatbot/data/j_collection_business_policy_addendum_v1_4_6.json):

- **Quyết định nghiệp vụ chính thức (`EVERY_EXTRA_HOUR_BOUNDARY`):**
  - Ân hạn `10 phút` được áp dụng lặp lại cho **từng mốc giờ phát sinh** sau `12:00` đối với gói `qua_dem` và `ngay_dem` trên cả ba cơ sở (`jacayl-ha-dong`, `jacayl-tran-khat-chan`, `j-village`).
  - Công thức chuẩn hóa trong [quote-types.ts](file:///C:/Chatbot/src/pricing/quote-types.ts) (`calculateLateCheckoutExtension`, `calculateQuote`) và [automated-pricing-oracle.ts](file:///C:/Chatbot/src/pricing/automated-pricing-oracle.ts) dùng nguồn cấu hình duy nhất từ [pricing-policy-loader.ts](file:///C:/Chatbot/src/data-loader/pricing-policy-loader.ts):
    $$\text{billableExtraHours} = \max\left(0,\ \left\lceil \frac{\text{lateMinutes} - \text{graceMinutes}}{60} \right\rceil\right)$$
    với phép chia số nguyên chính xác (`Math.floor((actualLateMinutes - graceMinutes + 59) / 60)` khi `actualLateMinutes > graceMinutes`) để không phát sinh sai số dấu phẩy động hay `-0`.
- **Kế thừa cộng dồn & bảo toàn V1.4.3–V1.4.5:**
  - `loadOwnerPolicyAddendums()` trong [pricing-policy-loader.ts](file:///C:/Chatbot/src/data-loader/pricing-policy-loader.ts) nạp và gộp tuyến tính theo thứ tự phiên bản (`1.4.4` → `1.4.5` → `1.4.6`): V1.4.6 chỉ ghi đè khối `late_checkout` (`grace_period_mode: "EVERY_EXTRA_HOUR_BOUNDARY"`, `rounding_method: "CEIL_AFTER_RECURRING_GRACE"`), đồng thời **giữ nguyên hoàn toàn chính sách bữa sáng `FALSE` từ V1.4.5** (`included_in_room_rate: false`, `service_available: false`, `separate_service_availability: "FALSE"`).
  - Các mốc giờ chuẩn (`qua_dem` `22:00`/ân hạn `21:40` → `12:00`, `ngay_dem` `14:00` → `12:00`), giá phòng dataset gốc và kiến trúc V3.0 FINAL giữ nguyên tuyệt đối (`0` thay đổi trong canonical dataset).

---

## 2. SOURCE DIFF SUMMARY

- **Diff nguồn (`src/`):** `20 files changed, 2931 insertions(+), 551 deletions(-)` đã xuất tại [v1-4-6-policy-diff.diff](file:///C:/Chatbot/artifacts/v1-4-6-policy-diff.diff).
- **Canonical data (`git status --short data/`):** Chỉ thêm các tệp addendum (`v1_4_4`, `v1_4_5`, [v1_4_6](file:///C:/Chatbot/data/j_collection_business_policy_addendum_v1_4_6.json)); dữ liệu phòng gốc không bị chỉnh sửa.
- **Các module cập nhật:**
  - Policy & Knowledge & Guardrails: [pricing-policy-loader.ts](file:///C:/Chatbot/src/data-loader/pricing-policy-loader.ts), [knowledge-base.ts](file:///C:/Chatbot/src/knowledge/knowledge-base.ts), [claim-validator.ts](file:///C:/Chatbot/src/conversation/grounding/claim-validator.ts).
  - Pricing & Oracle: [quote-types.ts](file:///C:/Chatbot/src/pricing/quote-types.ts), [automated-pricing-oracle.ts](file:///C:/Chatbot/src/pricing/automated-pricing-oracle.ts) (và `PreBookingQuoteEngine`).
  - Tools, Agent Prompt & Telemetry: [agent-tools.ts](file:///C:/Chatbot/src/agent/agent-tools.ts), [jcollection-agent.ts](file:///C:/Chatbot/src/agent/jcollection-agent.ts), [dashboard-server.ts](file:///C:/Chatbot/src/staff/server/dashboard-server.ts), [dashboard-html.ts](file:///C:/Chatbot/src/staff/server/dashboard-html.ts), [takeover-coordinator.ts](file:///C:/Chatbot/src/staff/takeover/takeover-coordinator.ts).

---

## 3. BOUNDARY TEST RESULTS (SECTION VI.A — BẢNG ĐỘC LẬP 20 MỐC)

Toàn bộ 20 mốc ranh giới trong [v1-4-6-recurring-grace-period.test.ts](file:///C:/Chatbot/tests/v1-4-6-recurring-grace-period.test.ts) đối chiếu độc lập giữa bảng kỳ vọng tính trước, `PreBookingQuoteEngine.getQuote`, `AutomatedPricingOracle.computeExpected` và `quote_price` đều khớp **20/20**:

- **0, 1, 9, 10 phút** (`12:00–12:10`): **0 giờ** phát sinh (`0đ`).
- **11, 59, 60, 61, 69, 70 phút** (`12:11–13:10`): **1 giờ** phát sinh (`100.000đ` chuẩn / `200.000đ` với `601`/`602` Hà Đông).
- **71, 119, 120, 121, 129, 130 phút** (`13:11–14:10`): **2 giờ** phát sinh (`200.000đ` / `400.000đ`).
- **131, 180, 190 phút** (`14:11–15:10`): **3 giờ** phát sinh (`300.000đ` / `600.000đ`).
- **191 phút** (`15:11`): **4 giờ** phát sinh (`400.000đ` / `800.000đ`).
- Ngoài ra đã kiểm tra: trả phòng trước `12:00` (`11:30` → `0đ`), check-in sau nửa đêm (`01:15` → mốc chuẩn `12:00` cùng ngày, `13:10` → `1h`), và múi giờ `Asia/Ho_Chi_Minh`.

---

## 4. MULTI-PROPERTY PRICING VERIFICATION (SECTION VI.B–D)

| Cơ sở & Phòng | Đơn giá phát sinh | Nhận → Trả phòng | Gói | Phí gói | Phát sinh V1.4.6 | Tổng tiền |
| :--- | ---: | :--- | :--- | ---: | ---: | ---: |
| Hà Đông `405-1st-time` | `100.000đ/h` | `22:00` → `12:10` | `qua_dem` | `420.000đ` | `0h = 0đ` | **420.000đ** |
| Hà Đông `405-1st-time` | `100.000đ/h` | `22:00` → `13:05 / 13:10` | `qua_dem` | `420.000đ` | `1h = 100.000đ` | **520.000đ** |
| Hà Đông `405-1st-time` | `100.000đ/h` | `22:00` → `13:11 / 14:10` | `qua_dem` | `420.000đ` | `2h = 200.000đ` | **620.000đ** |
| Hà Đông `405-1st-time` | `100.000đ/h` | `22:00` → `14:11 / 15:10` | `qua_dem` | `420.000đ` | `3h = 300.000đ` | **720.000đ** |
| Hà Đông `405-1st-time` | `100.000đ/h` | `20:00` → `14:10 / 14:11` | `ngay_dem` | `520.000đ` | `2h = 200k` / `3h = 300k` | **720.000đ / 820.000đ** |
| Hà Đông `601` & `602` | `200.000đ/h` | `22:00` → `13:10` | `qua_dem` | `700.000đ` | `1h = 200.000đ` | **900.000đ** |
| Hà Đông `601` & `602` | `200.000đ/h` | `22:00` → `13:11 / 14:05 / 14:10` | `qua_dem` | `700.000đ` | `2h = 400.000đ` | **1.100.000đ** |
| Hà Đông `601` & `602` | `200.000đ/h` | `22:00` → `14:11 / 14:15` | `qua_dem` | `700.000đ` | `3h = 600.000đ` | **1.300.000đ** |
| Trần Khát Chân `601-golden-inox` | `100.000đ/h` | `22:00` → `14:10` | `qua_dem` | `1.100.000đ` | `2h = 200.000đ` | **1.300.000đ** |
| J Village `601-lagoon` | `100.000đ/h` | `22:00` → `14:10` | `qua_dem` | `719.000đ` | `2h = 200.000đ` | **919.000đ** |

---

## 5. FULL REGRESSION & RECONCILIATION RESULTS

### Đối soát thay đổi kỳ vọng từ V1.4.5 → V1.4.6 ([v1-4-5-breakfast-and-late-checkout.test.ts](file:///C:/Chatbot/tests/v1-4-5-breakfast-and-late-checkout.test.ts))
- **Active addendum version:** `effectivePolicyVersion` chuyển từ `"1.4.5"` → `"1.4.6"`; ảnh chụp V1.4.5 lịch sử tiếp tục được kiểm tra tường minh qua `getV145PolicyAddendumPath()`.
- **Case E (`405` @ `22:00`, `100k/h`):**
  - `13:01` (trễ 61p): **V1.4.5 = 2h (`200k`, tổng `620k`)** → **V1.4.6 = 1h (`100k`, tổng `520k`)**.
  - `13:10` (trễ 70p): **V1.4.5 = 2h (`200k`, tổng `620k`)** → **V1.4.6 = 1h (`100k`, tổng `520k`)**.
  - `14:01` (trễ 121p): **V1.4.5 = 3h (`300k`, tổng `720k`)** → **V1.4.6 = 2h (`200k`, tổng `620k`)**.

### Kết quả chạy sau chỉnh sửa cuối cùng
- **Biên dịch (`npm.cmd run build`):** `tsc` exited `0`.
- **Offline Vitest:** **55 / 55 files PASS, 725 / 725 tests PASS** (gồm toàn bộ test nền + 5 test mới trong [v1-4-6-recurring-grace-period.test.ts](file:///C:/Chatbot/tests/v1-4-6-recurring-grace-period.test.ts)).
- **HTTP RBAC & Invariants ([m4-invariants-regression.test.ts](file:///C:/Chatbot/tests/m4-invariants-regression.test.ts)):** **1 / 1 file PASS, 7 / 7 tests PASS**.
  → **Tổng hợp Deterministic + Offline + HTTP RBAC:** **56 / 56 files, 732 / 732 tests PASS**.

---

## 6. LIVE LLM TRANSCRIPTS & ACTUAL QUOTE RESULTS

Kịch bản Live LLM ([live-v1-4-6-verify.ts](file:///C:/Chatbot/scripts/live-v1-4-6-verify.ts) → [live-v1-4-6-verification.json](file:///C:/Chatbot/artifacts/live-v1-4-6-verification.json), `STRICT_LIVE_ONLY=true`, `FREE_ONLY_MODE=true`) đạt **5 / 5 kịch bản `LIVE_LLM_DECISION_VERIFIED`** (0 deterministic fallback):

1. **`V146_MT1_405_2200_TO_1305`** (`gemini: gemini-3.5-flash-lite`)
   - Khách: *"Anh ghé phòng 405 tầm 10 giờ đêm nay, trưa mai khoảng 1 giờ 5 phút chiều mới trả phòng thì hết bao nhiêu?"*
   - Tool: `search_rooms` → `quote_price(room="405", checkin="22:00", checkout="13:05")`
   - Quote: `billable_extra_hours: 1`, `actual_late_checkout_minutes: 65`, `grace_period_mode: "EVERY_EXTRA_HOUR_BOUNDARY"`, `total_price_vnd: 520000`, `effective_policy_version: "1.4.6"`.
   - AI trả lời: **520.000đ** (`420.000đ` qua đêm + `100.000đ` cho 1 giờ phát sinh tại `13:05`, kèm lưu ý liên hệ lễ tân kiểm tra phòng trống thực tế).
2. **`V146_MT2_405_1310_VS_1311`** (`groq: qwen/qwen3.8-27b`)
   - Khách: *"Nếu anh cố ra trước 1h10 chiều mai với lại lỡ sang 1h11 thì tiền khác nhau thế nào em?"*
   - Tool: Model tự giữ nguyên `checkin_datetime: 22:00` từ ngữ cảnh và gọi `quote_price` cho cả `13:10` và `13:11`.
   - AI trả lời rõ ranh giới: **13:10 → 1 giờ (100.000đ) → tổng 520.000đ** vs **13:11 → 2 giờ (200.000đ) → tổng 620.000đ** (chênh 1 phút thêm 100.000đ).
3. **`V146_HD_COMPARE_405_VS_601_AT_1405`** (`groq: qwen/qwen3.8-27b`)
   - Khách: *"So sánh giúp anh tổng tiền phòng 405 và căn 50 Sắc Thái nếu 22h tối nay nhận phòng và 2h05 chiều mai trả nhé."*
   - Tool: `quote_price(room_ids=["405-1st-time", "601-50-sac-thai"], checkin="22:00", checkout="14:05")`.
   - Quotes: `405` = `620.000đ` (`420k + 2h x 100k`), `601` = `1.100.000đ` (`700k + 2h x 200k`).
4. **`V146_TKC_601_1410_AND_BREAKFAST`** (`groq: qwen/qwen3.8-27b`)
   - Khách: *"Phòng 601 bên Trần Khát Chân vào lúc 22h tối nay, chiều mai 14h10 trả thì tổng cộng bao nhiêu và có ăn sáng không?"*
   - Tool: `quote_price(property="jacayl-tran-khat-chan", room="601-golden-inox", checkin="22:00", checkout="14:10")`.
   - Quote: `1.300.000đ` (`1.100k + 2h x 100k`, `actual_late_checkout_minutes: 130`). AI báo **1.300.000đ** và khẳng định **không phục vụ bữa sáng** (kế thừa đúng V1.4.5 `FALSE`).
5. **`V146_JV_601_1410`** (`groq: qwen/qwen3.8-27b`)
   - Khách: *"Phòng 601 bên J Village tối nay 22h nhận phòng, trưa mai 2 giờ 10 chiều trả phòng hết tổng cộng mấy tiền?"*
   - Tool: `search_rooms` → `quote_price(property="j-village", room="601-lagoon", checkin="22:00", checkout="14:10")`.
   - Quote: `919.000đ` (`719k + 2h x 100k`). AI báo **919.000đ** kèm lưu ý đối soát lễ tân thực tế.

---

## 7. DASHBOARD ĐÃ BUILD & KHỞI ĐỘNG LẠI

- Đã biên dịch sạch (`npm.cmd run build`) và khởi động lại Staff Dashboard (`node dist/demo/dashboard-demo.js`) trên cổng `3000`.
- Xác minh trực tiếp qua endpoint `/api/telemetry` trên `http://127.0.0.1:3000/`:
  - `engine`: `"agentic"`
  - `buildVersion`: `"3.0.0-llm-native-final"`
  - `basePolicyVersion`: `"1.4.3"`
  - `effectivePolicyVersion`: `"1.4.6"`
  - `activeAddendumId`: `"J_COLLECTION_OWNER_POLICY_ADDENDUM_V1_4_6"`
  - `freeOnlyMode`: `true`
