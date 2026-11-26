# J COLLECTION — V3.0 FINAL
# BÁO CÁO NGHIỆM THU LIVE CANDIDATE: BUSINESS GROUNDING & EVALUATION INTEGRITY

- **Repository:** `C:\Chatbot`
- **Kiến trúc cố định:** Agentic AI System V3.0 FINAL — Reasoning-first · Tool-driven · Business-controlled
- **Frozen Baseline (không bị ghi đè):** Branch `main` @ `dc11876` | Tag `v3.0.0-final-policy-v1.4.6` | Business Policy `V1.4.6` | Running Dashboard Port `3000` (`dist/`, `data/staff_dashboard.db`)
- **Candidate Branch:** `feat/v3-final-grounding-eval-hardening`
- **Candidate Code Commit:** `d5b5bdb` (kế thừa từ `16924a4` / `1365f33`)
- **Isolated Candidate Runtime:** Port `3100` | Build `artifacts/candidate-runtime/dist` | DB `artifacts/candidate-runtime/candidate_dashboard.db`
- **Free-Only Enforcement:** `CONVERSATION_ENGINE=agentic`, `FREE_ONLY_MODE=true`, `STRICT_LIVE_ONLY=true` cho Gate 2 & Gate 3 Live Runs

---

## 1. Gate 1 — Source Review & Root-Cause Fixes (`dc11876 -> d5b5bdb`)

Kiểm toán source diff từ `dc11876` đến candidate `16924a4` phát hiện và xử lý triệt để 5 lỗi nền tảng trước khi chạy Live:

1. **Tách `invalidateStaleBusinessEvidence` khỏi `retractsBathtub` (`src/agent/jcollection-agent.ts`):**
   - Lỗi cũ gọi `invalidateStaleBusinessEvidence` bên trong `if (retractsBathtub)`. Đã gỡ khỏi nhánh rút bỏ tiện nghi; việc hủy hiệu lực chỉ xảy ra khi thay đổi ràng buộc định giá thực sự (`propertyId`, `effectivePolicyVersion`, `stayType`, `durationHours`, `checkinDatetime`, `checkoutDatetime`).
2. **Bổ sung kiểm tra đổi gói lưu trú `stayType` & giới hạn bộ nhớ evidence (`src/conversation/grounding/business-evidence.ts`):**
   - Thêm kiểm tra `STAY_TYPE_CHANGED` trong `invalidateStaleBusinessEvidence` khi `ev.evidenceType === 'QUOTE'` và `currentConstraints.stayType !== ev.stayPackage`.
   - Giới hạn danh sách `state.verifiedBusinessEvidence` tối đa 24 bản ghi gần nhất để kiểm soát tăng trưởng token/bộ nhớ phiên dài.
3. **Structured `ScopedRateFact[]` thay cho `alternateAmountsVnd` phẳng (`src/agent/agent-contracts.ts`, `src/conversation/grounding/business-evidence.ts`, `src/conversation/grounding/claim-validator.ts`):**
   - Gắn kiểu rõ ràng `{ amountVnd, role, roomId, category, stayPackage, durationHours, timeCondition, eligible }` cho `quote_price` (`TOTAL`, `BASE_2H`, `EXTRA_HOUR_RATE`, `EXTRA_HOUR_SUBTOTAL`, `PACKAGE_RATE`, `ALT_21_40`), `search_rooms`, `get_room_facts` và `get_policies`.
   - `get_policies` (nhóm `late_checkout`/`stay_hours`/`gio`) bổ sung đơn giá quá giờ thực tế của từng phòng theo `dataset.phong` (bao gồm `200.000đ/giờ` cho `601-50-sac-thai` và `602-playboy` Hà Đông).
   - Bổ sung kiểm tra `expectedQuotes` cho cả nhánh `CONDITIONAL_ON_CHECKIN_TIME` (`conditional_quotes`) và `stay_package_eligibility` thông qua `buildExpectedQuotesForValidation()` trong `src/agent/jcollection-agent.ts`.
4. **Sửa phân tách toán tử `+`/`=`, nhân hệ số giờ thêm, `claim_refs` theo `roomId`, & `MISSING_MEDIA_ATTACHMENT` trong `src/conversation/grounding/claim-validator.ts`:**
   - Thêm `+` và `=` vào ranh giới sub-clause trong `detectClauseEntityScope`, bỏ qua `"2h đầu"` / `"2h thêm"` / `"2 tiếng tiếp theo"` khi xác định tổng giờ lưu trú, nhận diện `\d+ x <đơn giá>` là đơn giá phát sinh giờ thêm.
   - Chấp nhận `claim_refs` theo canonical `roomId`/`roomCode` khi có `BusinessEvidenceRecord` hợp lệ đang kích hoạt; giữ nguyên chặn `REJECTED_INVALID_CLAIM_REF` khi `refId` không có trong bằng chứng hợp lệ.
   - Khi khách hàng yêu cầu rõ xem/gửi ảnh phòng mà `deliveredMedia` rỗng (trừ trường hợp hệ thống giải trình không có phòng/không có ảnh), trả `MISSING_EVIDENCE` (`MISSING_MEDIA_ATTACHMENT`) để Output Gate nhắc LLM gọi `get_room_media`.
5. **Isolated Candidate Runtime & Grounding Telemetry (`src/demo/dashboard-demo.ts`, `src/staff/takeover/takeover-coordinator.ts`, `src/staff/server/dashboard-server.ts`, `src/staff/server/dashboard-html.ts`):**
   - Hỗ trợ `STAFF_DB_PATH` và `DASHBOARD_PORT` để chạy cô lập trên cổng `3100`; bổ sung `gitCommit` và `groundingTelemetry` (`verifiedTurns`, `repairedTurns`, `blockedTurns`, `lastGroundingStatus`) vào `/api/telemetry` và Telemetry Modal.

---

## 2. Evidence Validity & Scoping Architecture

| Loại bằng chứng (`evidenceType`) | Nguồn tool | Phạm vi hiệu lực (`validityScope`) | Điều kiện vô hiệu hóa (`invalidateStaleBusinessEvidence`) |
| --- | --- | --- | --- |
| `QUOTE` | `quote_price` | `SESSION_WHILE_VALID` / `CONDITIONAL` | Đổi cơ sở (`propertyId`), đổi policy version, đổi gói (`stayType`), đổi `durationHours`, đổi `checkinDatetime` / `checkoutDatetime` |
| `CATALOG_SEARCH` | `search_rooms` | `SESSION_WHILE_VALID` | Đổi cơ sở hoặc đổi policy version (vẫn dùng tra cứu giá danh mục chuẩn khi `QUOTE` cũ không thuộc gói mới) |
| `ROOM_FACTS` | `get_room_facts` | `SESSION_WHILE_VALID` | Đổi cơ sở hoặc đổi policy version |
| `ROOM_MEDIA` | `get_room_media` | `SESSION_WHILE_VALID` (`state.mediaEvidenceCache`) | Đổi cơ sở; chỉ đính kèm ra ngoài khi lượt đó gọi `get_room_media` hoặc model truyền `media_refs` |
| `POLICY` | `get_policies` | `SESSION_WHILE_VALID` | Đổi cơ sở hoặc đổi policy version |

- Đã thêm **chốt chặn tồn kho thời gian thực (`REJECTED_UNVERIFIED_VACANCY_CLAIM`)**: cấm khẳng định phòng đang còn trống từ catalog tĩnh nếu thiếu disclaimer liên hệ lễ tân/chưa kết nối PMS.

---

## 3. Claim Validator False-Acceptance & False-Rejection Verification

Tất cả 23 ca kiểm thử trong [v3-business-grounding-and-eval-integrity.test.ts](file:///C:/Chatbot/tests/v3-business-grounding-and-eval-integrity.test.ts) đạt **23/23 PASS** (và tổng thể 56/56 suite offline đạt **749/749 PASS**):

- **Chống False-Acceptance:**
  - Chặn `450.000đ` / `590.000đ` / `750.000đ` (`SCENARIO-033`), `259.000đ` / `379.000đ` (`SCENARIO-009`), `560 đ` / `700 đ` (`SCENARIO-018`).
  - Chặn nhầm gói (`780.000đ` `ngay_dem` gắn nhãn `qua_dem`), nhầm phòng (`420.000đ` gắn cho Deluxe), chéo cơ sở (`HD` vs `TKC`).
  - Chặn phòng không tồn tại (`Phòng 301` Hà Đông), chặn khẳng định còn trống thời gian thực không kèm disclaimer, chặn `0đ` ưu đãi miễn phí không hợp lệ, chặn rò rỉ `referenceClock` chưa xác nhận (`SCENARIO-035`), chặn sai `effectivePolicyVersion` (`V1.4.4` vs `V1.4.6`).
- **Chống False-Rejection:**
  - Chấp nhận `12:00 trưa`, `0đ` ân hạn 10 phút & `0đ` không phụ thu lễ (tách biệt điều kiện), ngân sách khách nêu (`400k`, `600k`, `800k`), `49.000đ` chênh lệch ngân sách, định dạng `359.000đ (2h đầu 159.000đ + 2h thêm 200.000đ)` / `phụ thu 2 tiếng tiếp theo 200.000đ` / `2 x 100.000đ`, `claim_refs` theo `roomId`, và giữ `QUOTE` khi khách chỉ hủy yêu cầu bồn tắm.

---

## 4. Evaluation Reconciliation (`live-500-checkpoint.json` — 54 Scenarios / 96 Turns)

Đã cập nhật `OfflineEvaluationIntegrityAuditorV3` ([evaluation-integrity-v3.ts](file:///C:/Chatbot/src/testing/lab/evaluation-integrity-v3.ts)) với **4 trạng thái đầu ra loại trừ lẫn nhau hoàn toàn (`reconciliation_check_overlap_count = 0`)**:

| Nhóm đối soát (`by_terminal_outcome`) | Số lượng | Phân bổ theo commit | Scenario IDs / Ghi chú |
| --- | --- | --- | --- |
| `CONFIRMED_PASS` | **36** | pre-`dc11876`: `31` · `dc11876`: `5` | Đạt đủ 8 trục, `LIVE_COMPLETED`, `ACCURATE` |
| `CONFIRMED_FAIL` (`false_pass_count`) | **11** | pre-`dc11876`: `6` · `dc11876`: `5` | `SCENARIO-009`, `018`, `027`, `033`, `035`, `037`, `039`, `041`, `120`, `140`, `150` |
| `PENDING_HUMAN_REVIEW` (`human_review_queue_count`) | **5** | pre-`dc11876`: `5` · `dc11876`: `0` | `SCENARIO-007`, `014`, `490`, `495`, `500` (không còn trùng đếm vào `falsePassRegister`) |
| `BLOCKED` | **2** | pre-`dc11876`: `0` · `dc11876`: `2` | Upstream Free API block trong batch `dc11876` |
| **Tổng cộng** | **54** | **42 + 12 = 54** | `36 + 11 + 5 + 2 = 54` (`0` overlap) |

- File đối soát: [offline-reevaluation-54.json](file:///C:/Chatbot/artifacts/eval-integrity/offline-reevaluation-54.json), [false-pass-register.json](file:///C:/Chatbot/artifacts/eval-integrity/false-pass-register.json), [human-review-queue.json](file:///C:/Chatbot/artifacts/eval-integrity/human-review-queue.json).

---

## 5. Gate 2 — Critical Live Replay Transcripts (`d5b5bdb`)

Chạy bởi [live-candidate-gate2-replay.ts](file:///C:/Chatbot/scripts/live-candidate-gate2-replay.ts) với `FREE_ONLY_MODE=true`, `STRICT_LIVE_ONLY=true`; kết quả lưu tại [gate2-critical-replay.json](file:///C:/Chatbot/artifacts/eval-integrity/gate2-critical-replay.json):

- **Tổng hợp:** `9` cases (`8 LIVE_COMPLETED`, `1 BLOCKED` trên chế độ ép đơn lẻ `mode=groq` do `groq:429(24s)` TPM limit; lượt Groq thực tế sau đó đã xác minh thành công trong Gate 3 `SCENARIO-177 T1`).
- **`17` lượt:** `14 LIVE_LLM_DECISION_VERIFIED`, `1 BLOCKED` (Groq TPM), `2` lượt Output Gate tự chặn an toàn bằng fallback từ chối lịch sự (`grounding_blocks: 2`, `0` giá sai lọt ra ngoài), **`13/17` (76.5%) sạch ngay lần đầu (`firstAttemptClean`)**, `4` lượt tự sửa qua `GROUNDING_GATE`, **`rejected_claims_on_final_output: 0`**, **`raw_think_leaks: 0`**.
- **Chi tiết 2 ca Output Gate chặn an toàn (`REPLAY-SCENARIO-033 T1` & `035 T1`):**
  - `REPLAY-SCENARIO-033 T1`: Draft LLM nháp sai số học `259.000đ` / `439.000đ` / `160.000đ` (lỗi giống hệt `SCENARIO-009`), bị Output Gate phát hiện và chặn trước khi phát hành -> phản hồi từ chối xác nhận số, **0 giá sai lọt ra khách**; sang `T2` gọi `quote_price` trả đúng `700.000đ` cho `601 — 50 — Sắc Thái` gói qua đêm.
  - `REPLAY-SCENARIO-035 T1`: Bị chặn cụm `"phụ thu 2 tiếng tiếp theo 200.000đ"` (false-rejection trên mẫu câu đó); đã khắc phục ngay trong [claim-validator.ts](file:///C:/Chatbot/src/conversation/grounding/claim-validator.ts) và khóa bằng Test #23 (`23/23 PASS`) trước khi chạy Gate 3.

### Excerpt Thực Tế Các Ca Quan Trọng Gate 2

- **`REPLAY-SCENARIO-039 T1 -> T2` (`VERIFIED` cả 2 lượt):**
  - **T1 (`search_rooms, quote_price x3`, `7.5s`):** Trả đủ giá 4h `Standard` (`359.000đ` / `380.000đ`), `Deluxe` (`479.000đ` / `515.000đ`), `Concept` (`799.000đ` / `849.000đ`).
  - **T2 (`get_policies`, `10.4s`):** *"gói lưu trú qua đêm tại Jacayl Hà Đông áp dụng từ 22:00 (hỗ trợ nhận phòng sớm tối đa 20 phút từ 21:40) đến 12:00 trưa hôm sau... Có ân hạn 10 phút đầu (12:00–12:10) miễn phí... thường là 100.000đ/giờ, riêng phòng 601 và 602 là 200.000đ/giờ."*
- **`REPLAY-SCENARIO-041 T1 -> T2` (`VERIFIED` cả 2 lượt, không bịa Phòng 301):**
  - **T2 (`search_rooms`, `9.4s`):** *"Dạ tại cơ sở Jacayl Hà Đông bên em không có phòng 301 ạ. Tuy nhiên, ở tầng 3 bên em có các phòng rất đẹp thuộc hạng Deluxe như 302 — Barbie Bedroom, 303 — Rose Wine, 304 — French Kiss hoặc 305 — Yêu I."*
- **`REPLAY-QUOTE-REUSE-RETRACT T1 -> T2`:** Khách hỏi 201 có bồn tắm + giá 2h (`159.000đ` / `180.000đ`), T2 rút yêu cầu bồn tắm -> giữ nguyên báo giá `159.000đ` / `180.000đ` hợp lệ.
- **`REPLAY-PKG-SWITCH T1 -> T2` (TKC):** `201 — Sapphire` qua đêm (`900.000đ`) -> đổi sang ngày đêm (`1.100.000đ`), tự vô hiệu hóa quote cũ và gọi lại `quote_price`.
- **`REPLAY-MEDIA-CACHE T1 -> T2 -> T3` (J Village):** `T1` gửi album `202 — Neon` (`media=3`); `T2` hỏi tiện nghi trả lời không có bồn tắm với `media=0` (không auto-attach); `T3` khách xin lại ảnh -> tái sử dụng `media_refs` gắn `media=3` với `tools=[]` (`2.18s`).
- **`REPLAY-BUDGET-NO-QUOTE` (TKC):** Khách nêu ngân sách `400k` -> đối soát `Standard` thấp nhất `500.000đ`, **0 false-rejection** đối với số `400k` của khách.

---

## 6. Actual Tool Calls & Grounding Evidence Across Gate 2 & Gate 3

- `search_rooms`, `quote_price`, `get_room_facts`, `get_room_media`, `get_policies` hoạt động đúng hợp đồng dữ liệu trên cả 3 cơ sở.
- Tỷ lệ tự sửa hoặc chặn thành công ở Output Gate:
  - Gate 2: `4` lượt tự sửa thành công, `2` lượt chặn hoàn toàn số chưa xác thực/sai số học (`0` false claim lọt ra ngoài).
  - Gate 3: `5` lượt tự sửa thành công (`SCENARIO-252 T1`, `SCENARIO-385 T1`, `SCENARIO-048 T3`, v.v.), `1` lượt chặn an toàn (`SCENARIO-382 T1`).

---

## 7. Gate 3 — Stratified Sampling Manifest (`18` Scenarios = `3 x 6` Batches)

Manifest lưu tại [stratified-sampling-manifest-18.json](file:///C:/Chatbot/artifacts/eval-integrity/stratified-sampling-manifest-18.json):
- **Cơ sở:** `jacayl-ha-dong`: **6**, `jacayl-tran-khat-chan`: **6**, `j-village`: **6**.
- **Nhóm nhu cầu:** `photos_room_selection`: **5** (4 HD + 1 TKC), `amenities_features`: **4** (4 TKC), `requirement_context_changes`: **4** (4 JV), `faq_policies`: **3** (2 JV từ catalog 500 + `1` supplementary TKC FAQ `PILOT-TKC-FAQ-001` do catalog 500 gốc không gán `faq_policies` cho TKC), `pricing_time_packages`: **2** (2 HD).
- **Split & Độ dài:** `10` `held_out` (>= 4), `8` `discovery`; `12` `scripted_multi_turn` (>= 12), `6` `single_turn_scripted`; chia đều 3 batch (`batch_1`, `batch_2`, `batch_3`, mỗi batch gồm 2 HD + 2 TKC + 2 JV); toàn bộ prompt đã làm sạch hậu tố `[ID-...]` / `(#...)` và xoay vòng `referenceClock` theo 4 mốc.
- **Lưu ý bảo toàn:** `artifacts/live-500-batches/live-500-checkpoint.json` hoàn toàn không bị ghi đè.

---

## 8. Gate 3 — Stratified Live Execution Results (`31` Turns)

Lưu tại [gate3-stratified-results.json](file:///C:/Chatbot/artifacts/eval-integrity/gate3-stratified-results.json) bởi [live-candidate-gate3-stratified.ts](file:///C:/Chatbot/scripts/live-candidate-gate3-stratified.ts):

| Batch | Scenario ID | Property | Category | Split / Source | Turns | Tools Executed | Media | Latency (ms) | Tokens | Outcome (8-axis) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| batch_1 | `SCENARIO-177` | Hà Đông | `photos_room_selection` | `discovery` / 500 | 2 | `get_room_media`, `quote_price` | 8 | 33,037 | 11,275 | `CONFIRMED_PASS` (T1 Groq) |
| batch_1 | `SCENARIO-180` | Hà Đông | `photos_room_selection` | `held_out` / 500 | 2 | `search_rooms`, `get_room_media`, `quote_price` | 3 | 17,222 | 13,066 | `CONFIRMED_PASS` |
| batch_1 | `SCENARIO-210` | TKC | `photos_room_selection` | `held_out` / 500 | 2 | `get_room_media`, `quote_price` | 8 | 12,833 | 11,257 | `CONFIRMED_PASS` |
| batch_1 | `SCENARIO-252` | TKC | `amenities_features` | `discovery` / 500 | 2 | `get_room_facts` x2 | 0 | 38,649 | 16,567 | `CONFIRMED_PASS` |
| batch_1 | `SCENARIO-381` | J Village | `requirement_context_changes` | `discovery` / 500 | 1 | `search_rooms`, `quote_price` | 0 | 24,523 | 11,720 | `CONFIRMED_PASS` |
| batch_1 | `SCENARIO-385` | J Village | `requirement_context_changes` | `held_out` / 500 | 1 | `search_rooms`, `quote_price` | 0 | 31,017 | 10,931 | `CONFIRMED_PASS` |
| batch_2 | `SCENARIO-182` | Hà Đông | `photos_room_selection` | `discovery` / 500 | 2 | `get_room_media`, `quote_price` | 2 | 19,157 | 11,268 | `CONFIRMED_PASS` |
| batch_2 | `SCENARIO-195` | Hà Đông | `photos_room_selection` | `held_out` / 500 | 2 | `get_room_media`, `quote_price` | 4 | 17,681 | 11,455 | `CONFIRMED_PASS` |
| batch_2 | `SCENARIO-255` | TKC | `amenities_features` | `held_out` / 500 | 2 | `get_room_facts` x2 | 0 | 11,010 | 11,467 | `CONFIRMED_PASS` |
| batch_2 | `SCENARIO-258` | TKC | `amenities_features` | `discovery` / 500 | 2 | `get_room_facts` x2 | 0 | 14,297 | 11,221 | `CONFIRMED_PASS` |
| batch_2 | `SCENARIO-382` | J Village | `requirement_context_changes` | `discovery` / 500 | 1 | `search_rooms`, `quote_price` | 0 | 14,298 | 10,859 | `CONFIRMED_FAIL` (Grounding block từ chối an toàn) |
| batch_2 | `SCENARIO-390` | J Village | `requirement_context_changes` | `held_out` / 500 | 1 | `search_rooms`, `quote_price` | 0 | 5,694 | 8,521 | `CONFIRMED_PASS` |
| batch_3 | `SCENARIO-045` | Hà Đông | `pricing_time_packages` | `held_out` / 500 | 2 | `search_rooms`, `quote_price` x3, `get_policies` | 0 | 21,406 | 18,661 | `CONFIRMED_PASS` |
| batch_3 | `SCENARIO-048` | Hà Đông | `pricing_time_packages` | `discovery` / 500 | 3 | `search_rooms` x2, `quote_price`, `get_policies` | 0 | 25,520 | 26,826 | `CONFIRMED_PASS` |
| batch_3 | `SCENARIO-270` | TKC | `amenities_features` | `held_out` / 500 | 2 | `get_room_facts` | 0 | 12,429 | 8,433 | `CONFIRMED_PASS` |
| batch_3 | `PILOT-TKC-FAQ-001` | TKC | `faq_policies` | `held_out` / supp | 2 | `get_policies` x3 | 0 | 16,839 | 11,785 | `CONFIRMED_PASS` |
| batch_3 | `SCENARIO-435` | J Village | `faq_policies` | `held_out` / 500 | 1 | `get_policies` x2 | 0 | 12,057 | 6,318 | `CONFIRMED_PASS` |
| batch_3 | `SCENARIO-431` | J Village | `faq_policies` | `discovery` / 500 | 1 | `get_policies` | 0 | 4,939 | 5,704 | `CONFIRMED_PASS` |

- **Tổng hợp Gate 3 (18 scenarios / 31 turns):**
  - `CONFIRMED_PASS`: **17/18 (94.4%)** (`DEGRADED` từ chối an toàn: `1/18` — `SCENARIO-382` T1; `BLOCKED`: `0`; `false_pass`: `0` lượt lọt số sai).
  - `LIVE_LLM_DECISION_VERIFIED`: **30/31 turns (96.8%)**; **`first_attempt_clean_turns`: 27/31 (87.1%)**; `grounding_repairs`: **5**; `grounding_blocks`: **1**; `raw_think_leaks`: **0**; `failover_turns`: **7** (`1` Groq Qwen 3.8 27B + `6` Gemini 3.1 Flash-Lite fallback).
  - **Media Delivery:** **5/5** ca `photos_room_selection` đính kèm đủ ảnh chuẩn (`8, 3, 8, 2, 4`), `0` raw `.webp` link leak.

---

## 9. Token & Latency Comparison (`dc11876` vs Candidate `d5b5bdb`)

| Chỉ số vận hành | Frozen `dc11876` (17 verified turns) | Candidate `d5b5bdb` (Gate 3 — 31 turns) | Chênh lệch |
| --- | --- | --- | --- |
| Strict 8-axis `CONFIRMED_PASS` rate | **5 / 12** (`41.7%`; `5 / 10` non-blocked = `50.0%`) | **17 / 18** (`94.4%`; `0` blocked) | **+52.7 điểm %** |
| Avg Tokens / turn | `6,912` tokens | `7,011` tokens | `+99` tokens (`+1.4%`) |
| Avg Latency / turn | `10,270 ms` | `10,729 ms` | `+459 ms` (`+4.5%`) |
| P50 Latency / turn | `6,142 ms` | `8,127 ms` | `+1,985 ms` |
| P95 Latency / turn | `32,325 ms` | `31,017 ms` | `-1,308 ms` (`-4.0%`) |
| Raw `<think>` leaks | `0` | `0` | `0` |

---

## 10. Gate 4 — Full Regression & Isolated Browser E2E Verification

Tất cả kiểm thử chạy lại **sau lần sửa source cuối cùng**:
- **TypeScript & Candidate Isolated Build:** `npx.cmd tsc --noEmit` & `npx.cmd tsc --outDir artifacts/candidate-runtime/dist` -> Exit `0` (không chạm vào `C:\Chatbot\dist\`).
- **56 Offline Regression Suites:** `56/56` test files passed (**749/749** tests PASS, `0` failed, `0` skipped; tách riêng 4 file socket/live-network/E2E: `m4-invariants-regression`, `live-acceptance-20`, `free-api-smoke`, `real-api-live-verification`, và `tests/e2e/**`).
- **Socket & API Invariants (`tests/m4-invariants-regression.test.ts`):** **7/7** tests PASS.
- **Live 3-Property Browser E2E (`tests/e2e/agentic-v3-final-3property-e2e.test.ts`):** **1/1** PASS (Hà Đông + Trần Khát Chân + J Village, kiểm tra RBAC 3 tài khoản lễ tân/admin, Human Takeover chặn outbound AI, Media gallery + price + holiday policy). Total automated verified = **58/58 suites (757/757 tests)**.
- **Isolated Candidate Dashboard Port `3100` vs Frozen Port `3000` Probe (Playwright):**
  - Port `3000`: giữ nguyên bản đóng băng (`buildVersion: 3.0.0-llm-native-final`, `effectivePolicyVersion: 1.4.6`, chưa có `groundingTelemetry`).
  - Port `3100`: phản hồi trực tiếp khách hàng hỏi ảnh + giá 2h phòng `201 — La Casta` (`159.000đ`, `3` ảnh đính kèm), cập nhật trực tiếp Telemetry Modal (`Business Grounding Telemetry: Last: VERIFIED | Verified: 1 | Repaired: 0 | Blocked: 0`). Ảnh chụp màn hình: [candidate-port3100-telemetry.png](file:///C:/Chatbot/artifacts/screenshots/candidate-port3100-telemetry.png).

---

## 11. Candidate Commit & Final Source Diff Summary (`dc11876 -> d5b5bdb`)

- **Branch:** `feat/v3-final-grounding-eval-hardening`
- **Candidate Code Commit:** `d5b5bdb` (`main` vẫn khóa tại `dc11876`, tag `v3.0.0-final-policy-v1.4.6` giữ nguyên tại `dc11876`)
- **Diff File (Code/Tests/Scripts):** [candidate-vs-dc11876-final.diff](file:///C:/Chatbot/artifacts/eval-integrity/candidate-vs-dc11876-final.diff) (`16 files changed, 4,646 insertions(+), 116 deletions(-)`)
  - Runtime core: [agent-contracts.ts](file:///C:/Chatbot/src/agent/agent-contracts.ts), [jcollection-agent.ts](file:///C:/Chatbot/src/agent/jcollection-agent.ts), [conversation-types.ts](file:///C:/Chatbot/src/conversation/conversation-types.ts), [business-evidence.ts](file:///C:/Chatbot/src/conversation/grounding/business-evidence.ts), [claim-validator.ts](file:///C:/Chatbot/src/conversation/grounding/claim-validator.ts)
  - Dashboard isolation & telemetry: [dashboard-demo.ts](file:///C:/Chatbot/src/demo/dashboard-demo.ts), [dashboard-server.ts](file:///C:/Chatbot/src/staff/server/dashboard-server.ts), [dashboard-html.ts](file:///C:/Chatbot/src/staff/server/dashboard-html.ts), [takeover-coordinator.ts](file:///C:/Chatbot/src/staff/takeover/takeover-coordinator.ts)
  - Evaluation & tests: [evaluation-integrity-v3.ts](file:///C:/Chatbot/src/testing/lab/evaluation-integrity-v3.ts), [v3-business-grounding-and-eval-integrity.test.ts](file:///C:/Chatbot/tests/v3-business-grounding-and-eval-integrity.test.ts), [offline-eval-integrity-audit.ts](file:///C:/Chatbot/scripts/offline-eval-integrity-audit.ts), [live-candidate-gate2-replay.ts](file:///C:/Chatbot/scripts/live-candidate-gate2-replay.ts), [live-candidate-gate3-stratified.ts](file:///C:/Chatbot/scripts/live-candidate-gate3-stratified.ts), [live-500-batch-runner.ts](file:///C:/Chatbot/scripts/live-500-batch-runner.ts)

---

## 12. Release & Rollback Plan (Source, Build, Database, Process)

### 12.1. Hiện Trạng Song Song Đang Chạy
- **Frozen Production Pilot (Port `3000`):** đang phục vụ từ `C:\Chatbot\dist\demo\dashboard-demo.js` (`task-6187`) dùng database `C:\Chatbot\data\staff_dashboard.db` (source gốc `dc11876`).
- **Candidate Isolated Server (Port `3100`):** đang chạy kiểm thử tại `C:\Chatbot\artifacts\candidate-runtime\dist\demo\dashboard-demo.js` dùng `DASHBOARD_PORT=3100`, `STAFF_DB_PATH=C:\Chatbot\artifacts\candidate-runtime\candidate_dashboard.db`.

### 12.2. Quy Trình Promote Candidate Lên Port `3000` (CHỈ thực hiện khi Chủ dự án phê duyệt)
1. **Sao lưu dữ liệu & bản build đóng băng:**
   ```powershell
   Copy-Item C:\Chatbot\data\staff_dashboard.db C:\Chatbot\data\staff_dashboard.db.bak-dc11876
   Rename-Item C:\Chatbot\dist C:\Chatbot\dist-dc11876-bak
   ```
2. **Merge & Build Candidate:**
   ```powershell
   git checkout main
   git merge --no-ff feat/v3-final-grounding-eval-hardening
   npx.cmd tsc
   ```
3. **Khởi động lại Port `3000` trên bản build mới:**
   - Dừng tiến trình Dashboard port `3000` cũ (và dừng server thử nghiệm port `3100`), chạy `node dist/demo/dashboard-demo.js` với `CONVERSATION_ENGINE=agentic`, `FREE_ONLY_MODE=true` và kiểm tra `/api/telemetry` trả về `effectivePolicyVersion: "1.4.6"` + `groundingTelemetry`.

### 12.3. Quy Trình Rollback Về `dc11876` Trong 1 Phút (nếu cần)
1. **Dừng tiến trình Dashboard port `3000` hiện hành.**
2. **Khôi phục source / build / DB đóng băng:**
   ```powershell
   git checkout v3.0.0-final-policy-v1.4.6
   npx.cmd tsc
   # Hoặc khôi phục trực tiếp bản sao lưu nếu cần:
   Copy-Item C:\Chatbot\data\staff_dashboard.db.bak-dc11876 C:\Chatbot\data\staff_dashboard.db -Force
   ```
3. **Khởi động lại `node dist/demo/dashboard-demo.js`** và xác minh tag `v3.0.0-final-policy-v1.4.6` / Policy `V1.4.6` hoạt động bình thường.
