# J COLLECTION — V3.0 FINAL / BUSINESS POLICY V1.4.6 ACCEPTED
## Pilot Freeze, Odd-Second Consistency, Incremental Diff & Live Telemetry Report

- **Kiến trúc:** Agentic V3.0 FINAL — *Reasoning-first · Tool-driven · Business-controlled* (`CONVERSATION_ENGINE=agentic`, `FREE_ONLY_MODE=true`)
- **Build đóng băng:** `3.0.0-llm-native-final`
- **Git Commit:** `dc11876` (`dc11876a5be06b6e7c769ee62fb3f30dc5771f9c`)
- **Rollback Tag:** `v3.0.0-final-policy-v1.4.6`
- **Effective Policy:** `1.4.6` (`J_COLLECTION_OWNER_POLICY_ADDENDUM_V1_4_6`, kế thừa V1.4.5 + nền V1.4.3)
- **Staff Dashboard URL:** `http://127.0.0.1:3000` (đang chạy bản build `dist/demo/dashboard-demo.js` sau commit `dc11876`)

---

## 1. Xác nhận 12 hạng mục nghiệm thu & đóng băng Pilot

| # | Hạng mục yêu cầu | Trạng thái | Bằng chứng xác minh |
|---|---|---|---|
| 1 | Đóng băng Business Policy V1.4.6 | **ĐẠT** | `/api/telemetry` trên `127.0.0.1:3000` trả `effectivePolicyVersion: "1.4.6"`, `basePolicyVersion: "1.4.3"`, `activeAddendumId: "J_COLLECTION_OWNER_POLICY_ADDENDUM_V1_4_6"` |
| 2 | Bảo toàn không phục vụ bữa sáng | **ĐẠT** | Kế thừa `1.4.4 -> 1.4.5 -> 1.4.6` trong `src/data-loader/pricing-policy-loader.ts`; kiểm thử `tests/v1-4-5-breakfast-and-late-checkout.test.ts` & `tests/v1-4-6-recurring-grace-period.test.ts` PASS |
| 3 | Bảo toàn ân hạn 10 phút từng mốc giờ phát sinh | **ĐẠT** | `grace_period_mode: "EVERY_EXTRA_HOUR_BOUNDARY"` (`data/j_collection_business_policy_addendum_v1_4_6.json`), công thức chuẩn xác ở mức mili-giây/giây lẻ |
| 4 | Giữ nguyên canonical dataset 66 phòng & biểu giá | **ĐẠT** | `git status --short data/` chỉ có 3 tệp addendum (`v1_4_4`, `v1_4_5`, `v1_4_6`); 0 sửa đổi trên `j_collection_dataset.json`, `jacayl-ha-dong.json`, `jacayl-tran-khat-chan.json`, `j-village.json` |
| 5 | Bảo toàn 732+ bài kiểm thử hồi quy | **ĐẠT** | `55/55` offline (`726/726` tests) + `1/1` `tests/m4-invariants-regression.test.ts` (`7/7` tests) = **`56/56` files, `733/733` tests PASS** |
| 6 | Lưu commit/tag phục vụ rollback | **ĐẠT** | Commit `dc11876`, Tag `v3.0.0-final-policy-v1.4.6` (baseline trước đó: `74cc066`) |
| 7 | Phân tách diff V1.4.5 -> V1.4.6 vs diff tích lũy | **ĐẠT** | Xem Mục 2 (`artifacts/v1-4-5-to-v1-4-6-diff.diff` vs `artifacts/v1-4-6-policy-diff.diff`) |
| 8 | Nhất quán thời gian tại ranh giới giây lẻ | **ĐẠT** | Xem Mục 3 (`checkin-pricing-resolver.ts`, `quote-types.ts`, `agent-tools.ts`, 11 ca giây lẻ/ms trong test #6) |
| 9 | Tiếp tục Live 500 từ checkpoint, ghi policy & commit | **ĐẠT** | `scripts/live-500-batch-runner.ts` ghi rõ `effective_policy_version`, `build_version`, `git_commit`, `run_history`; tiến độ lên **`52/500`** `live_completed` (`52/52` đạt business invariants) |
| 10 | Ưu tiên hạn mức Free API cho Chủ dự án | **ĐẠT** | Chạy batch giới hạn `--batch=12`, pacing `4.5s`/`11s`, tự dừng khi chạm 2 block liên tiếp, `FREE_ONLY_MODE=true` |
| 11 | Theo dõi độ trễ, `429`/`503`, failover, degraded | **ĐẠT** | Xem Mục 4 (`avg 13446 ms`, `p50 7404 ms`, `p95 41237 ms`, `failover_turns: 9`, `degraded_mode_turns: 0`) |
| 12 | Browser E2E 3 cơ sở trên bản đóng băng V1.4.6 | **ĐẠT** | `tests/e2e/agentic-v3-final-3property-e2e.test.ts`: **`1/1 PASSED`** (`100,313 ms`) |

---

## 2. Phân tách Diff & Quy trình Rollback

- **Diff riêng `V1.4.5 -> V1.4.6`:** [`artifacts/v1-4-5-to-v1-4-6-diff.diff`](../../artifacts/v1-4-5-to-v1-4-6-diff.diff) (`1,554` dòng, `12` tệp):
  - `data/j_collection_business_policy_addendum_v1_4_6.json`
  - `src/data-loader/pricing-policy-loader.ts`
  - `src/pricing/checkin-pricing-resolver.ts`
  - `src/pricing/quote-types.ts`
  - `src/agent/agent-tools.ts`
  - `src/agent/jcollection-agent.ts`
  - `src/conversation/grounding/claim-validator.ts`
  - `src/knowledge/knowledge-base.ts`
  - `src/staff/server/dashboard-html.ts`
  - `tests/v1-4-6-recurring-grace-period.test.ts`
  - `scripts/live-v1-4-6-verify.ts`
  - `scripts/live-500-batch-runner.ts`
- **Diff tích lũy `74cc066 -> V1.4.6` (`src/`):** [`artifacts/v1-4-6-policy-diff.diff`](../../artifacts/v1-4-6-policy-diff.diff) (`5,186` dòng, `20 files changed, 2959 insertions(+), 552 deletions(-)`).
- **Snapshot diff `V1.4.5` (`src/`):** [`artifacts/v1-4-5-policy-diff.diff`](../../artifacts/v1-4-5-policy-diff.diff) (`5,038` dòng).

### Lệnh Rollback nhanh
- Quay về đúng điểm đóng băng V1.4.6 sạch:
  ```powershell
  git checkout v3.0.0-final-policy-v1.4.6
  npm.cmd run build
  ```
- Hoàn tác hoàn toàn về commit baseline trước nhánh cập nhật (`74cc066`):
  ```powershell
  git checkout 74cc066
  ```

---

## 3. Khắc phục nhất quán ranh giới ân hạn tại giây lẻ & mili-giây

### Nguyên nhân gốc rễ đã phát hiện
1. `parseVietnamDateTime` (`src/pricing/checkin-pricing-resolver.ts`) trước đây dù trích xuất `second` qua `Intl.DateTimeFormat` nhưng vẫn ghép cứng `:00+07:00` vào `isoNormalized` và làm mất phần giây lẻ / mili-giây.
2. `calculateLateCheckoutExtension` (`src/pricing/quote-types.ts`) tính `Math.floor((checkoutMs - standardMs) / 60000)` dẫn tới cắt cụt giây lẻ tại các mốc ranh giới 10 phút (`12:10:01` hoặc `12:10:00.500` bị làm tròn xuống `10 phút`, gây lệch giữa thực tế qua mốc ân hạn `10 phút 00 giây` và số giờ phát sinh, hoặc lệch khi `AutomatedPricingOracle.validateQuote` đối chiếu lại `confirmed_checkout`).

### Thay đổi đã áp dụng
- `src/pricing/checkin-pricing-resolver.ts`: `VietnamDateTimeParts` bổ sung `second?: number` và `exactEpochMs?: number`; `isoNormalized` giữ nguyên giây thực tế (và hậu tố `.SSS` khi có mili-giây khác `0`) theo múi giờ `+07:00`.
- `src/pricing/quote-types.ts`: `calculateLateCheckoutExtension` tính `actualLateMs = Math.max(0, checkoutMs - standardMs)` trên mili-giây chính xác (`graceMs = 600_000`, `hourMs = 3_600_000`), kiểm tra `actualLateMs > graceMs` trước khi tính `Math.floor((actualLateMs - graceMs + hourMs - 1) / hourMs)`, và xuất thêm `actual_late_checkout_seconds`.
- `src/agent/agent-tools.ts`: Xuất kèm `actual_late_checkout_seconds` trong payload báo giá `quote_price` và kích hoạt lưu ý không có PMS realtime khi có giây trễ (`actual_late_checkout_seconds > 0`).

### Kết quả kiểm thử ranh giới giây lẻ (`tests/v1-4-6-recurring-grace-period.test.ts` — Test #6, Phòng 405 Hà Đông 22:00 Qua đêm 420k, phát sinh 100k/h)
- `12:00:30` -> `30s`, `0m` -> `0h` (`420.000đ`)
- `12:10:00` -> `600s`, `10m` -> `0h` (`420.000đ`)
- `12:10:00.500` -> `600s`, `10m` (600,500 ms > 600,000 ms) -> `1h` (`520.000đ`, đồng nhất với `AutomatedPricingOracle`)
- `12:10:01` -> `601s`, `10m` -> `1h` (`520.000đ`)
- `13:09:59` -> `4199s`, `69m` -> `1h` (`520.000đ`)
- `13:10:00` -> `4200s`, `70m` -> `1h` (`520.000đ`)
- `13:10:01` -> `4201s`, `70m` -> `2h` (`620.000đ`)
- `13:10:30` -> `4230s`, `70m` -> `2h` (`620.000đ`)
- `14:10:00` -> `7800s`, `130m` -> `2h` (`620.000đ`)
- `14:10:01` -> `7801s`, `130m` -> `3h` (`720.000đ`)
- `14:10:59` -> `7859s`, `130m` -> `3h` (`720.000đ`)

---

## 4. Đánh giá Live 500 (nối tiếp checkpoint) & Telemetry độ tin cậy

### Tiến độ Live 500 (`artifacts/live-500-batches/live-500-summary.json`)
- **Run ID mới nhất:** `live500_2026-11-25T19-13-56-066Z_dc11876`
- **Cấu hình thực thi:** `effective_policy_version: "1.4.6"`, `base_policy_version: "1.4.3"`, `build_version: "3.0.0-llm-native-final"`, `git_commit: "dc11876"`, `strict_live_only: true`, `free_only_mode: true`
- **Kết quả batch (`--batch=12`, SCENARIO-031..042):**
  - `batch_attempted`: `12`
  - `batch_completed`: **`10`** (`SCENARIO-031`, `033..039`, `041`, `042`) — **100% pass business invariants**
  - `batch_blocked`: **`2`** (`SCENARIO-032`, `SCENARIO-040` do upstream Gemini trả HTTP `503 UNAVAILABLE` + fallback `gemini-3.1-flash-lite` timeout `15000ms` + Groq `429` tạm thời)
  - `batch_failed`: **`0`**
- **Tổng tích lũy trên 500 kịch bản:**
  - `live_completed`: **`52 / 500`** (`52/52` đạt business invariants)
  - `live_blocked`: **`2`**
  - `live_failed`: **`0`**
  - `deterministic_offline_unrun_in_live_batch`: **`446`**

### Độ trễ, Rate Limit, Failover & Degraded Mode (Run `dc11876`)
- **Độ trễ mỗi lượt LLM:** `avg_latency_ms = 13,446 ms` · `p50_latency_ms = 7,404 ms` · `p95_latency_ms = 41,237 ms`
- **Failover & Degraded Mode:** `failover_turns = 9` · `degraded_mode_turns = 0` (tuyệt đối không fallback sang solver tất định)
- **Gateway Reliability:**
  - **Gemini Free Tier:** `42` calls · `28` successes · `0` HTTP `429` · `7` HTTP `503` · `7` timeouts/otherErrors (`89,518` prompt / `7,245` completion tokens)
  - **Groq Free Tier:** `12` calls · `10` successes · `2` HTTP `429` · `0` HTTP `503` · `0` otherErrors (`29,801` prompt / `2,201` completion tokens)

---

## 5. Browser E2E 3 Cơ Sở & Vận hành Pilot cho Chủ dự án

- **Kết quả `tests/e2e/agentic-v3-final-3property-e2e.test.ts`:** **`1/1 PASSED`** (`100,313 ms` test / `102.48s` tổng):
  - **Jacayl Hà Đông (`staff_hadong`):** Hỏi tình trạng phòng, kiểm tra Telemetry Modal hiển thị `3.0.0-llm-native-final`, hỏi ảnh & giá phòng 601, đổi yêu cầu sang phòng rẻ nhất (Standard/201), bấm **Tiếp quản (Human Takeover)** và xác minh 0 tin nhắn AI phát sinh sau tiếp quản.
  - **Jacayl Trần Khát Chân (`staff_tkc`):** Báo giá Phòng `1001 Đêm` qua đêm & xác nhận đúng quy tắc cuối tuần không tăng giá.
  - **J Village (`staff_village`):** Kiểm tra Phòng `Crimson Suite` (bồn tắm, hình ảnh, giá 2h).
- **Khuyến nghị bảo toàn hạn mức Free API cho Chủ dự án:**
  - Bộ đánh giá nền đã dừng gọn sau batch 12 kịch bản và hoàn thành E2E 3 cơ sở; không còn tiến trình đánh giá hàng loạt chạy nền tiêu hao RPM/TPD.
  - Chỉ còn duy nhất tiến trình Staff Dashboard (`http://127.0.0.1:3000`, `FREE_ONLY_MODE=true`) đang lắng nghe phục vụ Chủ dự án kiểm thử trực tiếp.
