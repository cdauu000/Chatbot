# J COLLECTION — V3.0 FINAL
## BUSINESS GROUNDING & EVALUATION INTEGRITY HARDENING REPORT

- **Kiến trúc:** Agentic AI System — *Reasoning-first · Tool-driven · Business-controlled* (giữ nguyên lõi LLM-Native V3.0 FINAL, 0 Intent Router / Planner / Regex nhận diện câu hỏi / Response Template).
- **Nhánh phát triển candidate:** `feat/v3-final-grounding-eval-hardening` (tách riêng từ `dc11876`, commit code chính `16924a4`).
- **Baseline đóng băng được bảo toàn nguyên trạng:** Commit `dc11876` (nhánh `main`), Tag `v3.0.0-final-policy-v1.4.6`, Business Policy `V1.4.6`, canonical dataset 66 phòng và Staff Dashboard tại `http://127.0.0.1:3000` (`task-6187`, `dist/` không bị ghi đè, **0 lượt gọi API Live mới**).

---

## 1. Root-Cause Correction Report (Khắc phục nguyên nhân gốc rễ từ Audit `19_...`)

| Vấn đề Audit (`dc11876` & lịch sử) | Nguyên nhân gốc rễ đã xử lý | Giải pháp tổng quát đã triển khai |
|---|---|---|
| **`SCENARIO-033` (T2)** — Model đoán `450k / 590k / 750k` với `toolsExecuted: []`, lọt `ClaimValidator` và `businessPassed: true` | *(i)* `buildLLMReasoningPrompt` không cung cấp tóm tắt evidence có phạm vi hiệu lực từ lượt trước; *(ii)* `RESPOND_DIRECTLY` kết thúc ngay mà không hậu kiểm grounding; *(iii)* `ClaimValidator` bỏ quên `context.expectedQuotes` và không trích xuất tiền VND; *(iv)* `evaluateInvariants()` chỉ check 7 chuỗi hẹp. | Bổ sung `BusinessEvidenceRecord` có hiệu lực theo phạm vi + **Output Grounding Gate** kiểm tra mọi action phát sinh text (`RESPOND_DIRECTLY`, `CLARIFY`, `ESCALATE`), phản hồi lỗi thiếu bằng chứng cho chính LLM tự sửa trong `maxIterations`, và chặn phát hành nếu vẫn chưa xác thực được. |
| **`SCENARIO-039`** — Hỏi giá 4h nhưng mới trả giá 2h | Model dừng sớm với `RESPOND_DIRECTLY` dù mục tiêu 4h chưa được báo giá; evaluator không kiểm tra goal completion. | Prompt cập nhật yêu cầu gọi `quote_price` tính đủ thời lượng; **Offline 8-Axis Auditor** tách `goal_completion: INCOMPLETE`. |
| **`SCENARIO-041`** — Gợi ý `"Phòng 301"` không tồn tại ở Hà Đông | Model tự suy đoán dãy số; `ClaimValidator` §7.4 chỉ chặn 5 tên phòng giả lịch sử. | Kiểm tra mã phòng khẳng định tồn tại dựa trên catalog động `this.dataset.phong` theo `propertyId::roomId`, đồng thời cho phép AI phủ định đúng phòng không tồn tại. |
| **`SCENARIO-035` & `037`** — Neo `referenceClock` (`14:00` Thứ Bảy) thành giờ check-in xác nhận | `Temporal Context` in `Current Local Time` dễ bị hiểu thành giờ khách đến; evaluator cố định 1 mốc Thứ Bảy `14:00`. | Phân tách nhãn `Reference Clock ONLY — NOT Confirmed Check-in`, bổ sung `validateTemporalHygiene()`, và xoay vòng 4 mốc `referenceClock` trong stratified manifest. |
| **Lịch sử (`009`, `018`, `027`, `120`)** | Sai cộng tổng (`259k`/`379k`), cụt đơn vị (`560 đ`), sai quy tắc `ngay_dem`, dán link `.webp` thô với `deliveredMedia: []`. | Chuẩn hóa Unicode VND + đối chiếu `expectedQuotes` & catalog theo hạng/gói, thêm `media_refs` replay album và bắt `MISSING_MEDIA_ATTACHMENT` cho mọi diễn đạt hỏi ảnh. |

---

## 2. Business Evidence Contract & Quy tắc hiệu lực (`src/conversation/grounding/business-evidence.ts`)

Mở rộng trực tiếp [`agent-contracts.ts`](../../src/agent/agent-contracts.ts) và [`AgentState`](../../src/agent/jcollection-agent.ts) (không dựng thêm Evidence Engine tách rời):
- **`BusinessEvidenceRecord`:** lưu `evidenceId`, `propertyId`, `roomId`/`roomCode`/`roomName`/`category`, `evidenceType` (`QUOTE` | `CATALOG_SEARCH` | `ROOM_FACTS` | `ROOM_MEDIA` | `POLICY`), `toolSource`, `stayPackage`, `amountVnd`, `basePriceVnd`, `extraHourRateVnd`, `extraHourSubtotalVnd`, `alternateAmountsVnd`, `categoryRateSnapshots` (dạng mảng đa phòng theo hạng), `checkinDatetime`, `checkoutDatetime`, `durationHours`, `conditions`, `effectivePolicyVersion`, `datasetVersion` (`canonical#<sha256_8>`), `validityScope`, `isValid`, `invalidatedReason`, `recordedTurn`.
- **Phân tách bộ nhớ:**
  1. *Conversation memory* (`state.conversationHistory`) — chỉ là ngữ cảnh hội thoại, **không** dùng làm nguồn sự thật giá.
  2. *Verified business evidence* (`state.verifiedBusinessEvidence` + `state.mediaEvidenceCache`) — tái sử dụng qua `formatValidEvidenceForPrompt(state)` nếu còn `isValid === true`.
  3. *Current-turn observations* (`turnObservations`) — quan sát công cụ và phản hồi từ `grounding_validator` trong lượt.
  4. *Audit trace* (`decisionSteps`, `claimsChecked`) — vết kiểm toán đầy đủ.
- **Invalidation rules (`invalidateStaleBusinessEvidence`):** vô hiệu hóa `QUOTE` khi đổi `propertyId`, `effectivePolicyVersion`, `durationHours` gói giờ, `checkinDatetime` hoặc `checkoutDatetime`, hoặc khi khách rút lại ràng buộc (`retractsBathtub`).

---

## 3. Thay đổi `ClaimLevelValidator` ([`src/conversation/grounding/claim-validator.ts`](../../src/conversation/grounding/claim-validator.ts))

1. **Kích hoạt `context.expectedQuotes` & `context.validEvidence`:** Đối chiếu chính xác theo `propertyId` -> `roomId`/`category` -> `stayPackage` (`nghi_gio`/`qua_dem`/`ngay_dem`/`EXTRA_HOUR`) -> `durationHours` -> `effectivePolicyVersion`.
2. **Chuẩn hóa tiền tệ VND Unicode (`extractVndMentions`):** Hỗ trợ `.`, `,`, khoảng trắng Unicode (`\u00a0`, `\u202f` như `420 000 đ`), `k`/`nghìn`/`ngàn`/`triệu`/`tr`, `0đ`, cùng negative lookbehind/lookahead Unicode (`(?<!:)`, `(?![\p{L}\d])`) để không bắt nhầm `"12:00 trưa"` (`00 tr`). **Không** dùng ngưỡng `< 10.000đ` để FAIL cứng.
3. **Phân vai ngữ nghĩa của số tiền:** Phân biệt rõ *ngân sách/giá khách nêu* (`NOT_APPLICABLE`), *chênh lệch giữa các phương án* (`delta`), *phí 0đ hợp lệ theo ân hạn/ngày lễ* (`VERIFIED`), và *báo giá khách sạn* (`VERIFIED` / `CONTRADICTED` / `MISSING_EVIDENCE`).
4. **Structured Claim Refs (`claim_refs`):** Kiểm tra chéo ID bằng chứng cấu trúc và con số trong `final_response`.
5. **Dynamic Room Identity (`propertyId::roomId`):** Kiểm tra mã phòng từ `this.dataset.phong` (không whitelist viết tay); **cho phép** phủ định/giải thích phòng không tồn tại, chỉ reject khi khẳng định/gợi ý tồn tại phòng không có trong catalog.
6. **Grounding Outcomes rõ ràng:** Trả về `grounding_status: 'VERIFIED' | 'CONTRADICTED' | 'MISSING_EVIDENCE' | 'NOT_APPLICABLE'` cùng `claim_checks[]`, `missing_evidence_claims[]`, `contradicted_claims[]`. Không coi `rejected_claims: []` là đủ để kết luận `VERIFIED`.

---

## 4. Final Response Validation Gate ([`src/agent/jcollection-agent.ts`](../../src/agent/jcollection-agent.ts))

- Hậu kiểm áp dụng cho **mọi** action phát sinh text LLM (`RESPOND_DIRECTLY`, `CLARIFY`, `ESCALATE`).
- Không đánh giá theo `toolsExecuted.length === 0`: nếu evidence lượt trước còn hợp lệ (`isValid === true`), lượt sau được phép dùng lại trực tiếp không cần gọi tool thừa (Test #7).
- Khi `grounding_status === 'CONTRADICTED' | 'MISSING_EVIDENCE'` ở iteration `< maxIterations`: đẩy `GROUNDING_GATE` observation vào `decisionSteps` (`phase: 'REVISE'`) để **chính LLM** tự quyết định gọi tool hoặc điều chỉnh câu trả lời.
- Khi hết `maxIterations` mà vẫn còn khẳng định chưa xác thực: chặn không phát hành text chưa xác thực (`groundingBlocked = true`), trả thông báo an toàn mời liên hệ lễ tân và không gán `LIVE_LLM_DECISION_VERIFIED`.

---

## 5. Xác minh Media Delivery & Temporal Context

- **Media Delivery (`media_refs` + attachment check):** `AgentState.mediaEvidenceCache` cache `RoomPresentationBlock` theo `propertyId::roomId`. Khi khách xin xem/gửi lại ảnh ở lượt sau, model có thể trả `media_refs: ["101-long-chim"]` để backend đính kèm lại đúng album canonical mà không phải tự động gửi ảnh ở lượt hỏi thông thường (Test #12). Dán link `.webp` thô với `deliveredMedia: []` bị bắt `MISSING_MEDIA_ATTACHMENT`.
- **Temporal Context:** `buildLLMReasoningPrompt` tách rõ `Message Received Timestamp (Reference Clock ONLY — NOT Confirmed Check-in)` khỏi giờ khách xác nhận; `validateTemporalHygiene()` chặn trường hợp tự biến giờ `referenceClock` (như `14:00`) thành `"từ 14:00 chiều nay"` khi khách không nêu giờ (Test #13), đồng thời miễn trừ chuẩn cho mô tả gói ngày đêm `"từ 14:00 hôm nay đến 12:00 trưa hôm sau"` (`false-rejection = 0`).

---

## 6. Kết quả tái đánh giá Offline 8 trục (54 Scenarios / 96 Turns)

Thực thi **100% offline** bằng [`OfflineEvaluationIntegrityAuditorV3`](../../src/testing/lab/evaluation-integrity-v3.ts) và [`scripts/offline-eval-integrity-audit.ts`](../../scripts/offline-eval-integrity-audit.ts) trên dữ liệu đã lưu ([`live-500-checkpoint.json`](../../artifacts/live-500-batches/live-500-checkpoint.json) và benchmark gốc được giữ nguyên vẹn):

- **Báo cáo lưu tại:** [`artifacts/eval-integrity/offline-reevaluation-54.json`](../../artifacts/eval-integrity/offline-reevaluation-54.json)
- **Tổng hợp 8 trục:**
  - `execution_status === 'LIVE_COMPLETED'`: **52 / 54** · `BLOCKED`: **2 / 54** (`SCENARIO-032`, `040`) · `DEGRADED`: **0**
  - `historical_businessPassed_true`: **52 / 54**
  - **`strict_quality_passed_true` (tách biệt theo 8 trục):** **32 / 54**
  - **Phân tách theo commit:**
    - `pre-dc11876` (42 ca): `42` `LIVE_COMPLETED`, **`29` `quality_passed`**, **`13` False-PASS**
    - `commit dc11876` (12 ca): `10` `LIVE_COMPLETED`, `2` `BLOCKED`, **`3` `quality_passed`**, **`7` False-PASS**

---

## 7 & 8. False-PASS Detection & False-Rejection Results

- **False-PASS Register ([`artifacts/eval-integrity/false-pass-register.json`](../../artifacts/eval-integrity/false-pass-register.json) — `20` ca):**
  - Bắt đầy đủ 8 ca trọng điểm đã đăng ký: `SCENARIO-009` (`259k`/`379k`), `SCENARIO-018` (`560 đ`/`700 đ`), `SCENARIO-027` (`INCOMPLETE_GOAL_4H_QUOTE` + `POLICY_RULE_VIOLATION`), `SCENARIO-033` (`450k/590k/750k`), `SCENARIO-035` (`TEMPORAL_LEAK 14:00`), `SCENARIO-039` (`INCOMPLETE_GOAL_4H_QUOTE`), `SCENARIO-041` (`Room 301`), `SCENARIO-120` (`MISSING_MEDIA_ATTACHMENT` + raw `.webp`), cùng các ca cùng mẫu lỗi `036`, `037`, `042`, `060`, `070`, `090`, `140`, `150`, `330`, `350`, và 2 ca thiếu báo giá qua đêm `007`, `014`.
- **False-Rejection Verification (`tests/v3-business-grounding-and-eval-integrity.test.ts` Test #5, #6, #11, #13, #16 & offline audit):**
  - Không bắt nhầm: `0đ phát sinh`, ngân sách khách (`600.000đ`), câu phủ định phòng không tồn tại (`"không có phòng 301"`), `"12:00 trưa"`, chuỗi gói ngày đêm `"từ 14:00 hôm nay đến 12:00"`, nhiều hạng/gói trên cùng 1 dòng (`Standard 420k, Deluxe 560k, Concept 700k`), `420 000 đ` dùng khoảng trắng Unicode, và các ca hợp lệ `001`, `003`, `070` T1, `345`, `490`, `495`.

---

## 9. Offline Verification & Full Regression Results

- **Biên dịch TypeScript (`npx.cmd tsc --noEmit`):** Exit `0` (không ghi đè `dist/`).
- **15 bài Mutation & Structured-Fixture Replay (`tests/v3-business-grounding-and-eval-integrity.test.ts`):** **`15 / 15 PASS` (`159 ms`)** — phủ đủ 14 nhóm kịch bản Mục X + kiểm tra audit/sampling manifest (#15) + false-rejection (#16).
- **100-Scenario Blind Benchmark + 50 Generalization:** `100/100 PASS` + `50/50 PASS` (100% Turn Pass Rate, `0` Ungrounded Claims, `100%` Tool Invocation Accuracy).
- **Full Regression Suite (chạy sau lần sửa code cuối cùng):**
  - Offline suite (`task-6423`, loại trừ E2E và các file live/smoke): **`56 / 56` tệp, `741 / 741` tests PASS**.
  - `tests/m4-invariants-regression.test.ts`: **`1 / 1` tệp, `7 / 7` tests PASS**.
  - **Tổng cộng đã xác minh:** **`57 / 57` tệp, `748 / 748` tests PASS** (bảo toàn 733 test cũ + 15 test mới; RBAC, Tenant Isolation, Human Takeover, Pricing Engine V1.4.6 và Media invariants nguyên vẹn).

---

## 10. Source Diff từ `dc11876`

- **Tệp diff chuẩn:** [`artifacts/eval-integrity/candidate-vs-dc11876.diff`](../../artifacts/eval-integrity/candidate-vs-dc11876.diff) (`3,766` dòng).
- **Thống kê (`git diff --stat dc11876 -- src/ scripts/ tests/`):** `9 files changed, 3208 insertions(+), 112 deletions(-)`:
  - `src/agent/agent-contracts.ts` (`+48/-...`)
  - `src/agent/jcollection-agent.ts` (`+186/-...`)
  - `src/conversation/conversation-types.ts` (`+14`)
  - `src/conversation/grounding/business-evidence.ts` (`+475`, new)
  - `src/conversation/grounding/claim-validator.ts` (`+1059/-...`)
  - `src/testing/lab/evaluation-integrity-v3.ts` (`+788`, new)
  - `scripts/live-500-batch-runner.ts` (`+43/-...`)
  - `scripts/offline-eval-integrity-audit.ts` (`+97`, new)
  - `tests/v3-business-grounding-and-eval-integrity.test.ts` (`+610`, new)

---

## 11. Stratified Sampling Manifest (Chưa chạy Live)

- **Tệp manifest:** [`artifacts/eval-integrity/stratified-sampling-manifest-18.json`](../../artifacts/eval-integrity/stratified-sampling-manifest-18.json) (`execution_status: PLANNED_NOT_EXECUTED_AWAITING_OWNER_APPROVAL`).
- **Phân bổ 18 ca:** `6` Hà Đông · `6` Trần Khát Chân · `6` J Village; `14` `discovery` + `4` `held_out`; `12` `scripted_multi_turn` + `6` `single_turn_scripted`; phủ đủ `photos_room_selection` (`5`), `pricing_time_packages` (`4`), `advice_preferences_budget` (`4`), `availability_catalog_categories` (`1`), `amenities_features` (`1`), `requirement_context_changes` (`1`), `faq_policies` (`1`), `booking_handoff_closing` (`1`).
- Toàn bộ `cleanTurnMessages` đã tách bỏ hậu tố ID debug khỏi văn bản khách (chỉ giữ `scenarioId` trong metadata) và xoay vòng 4 mốc `referenceClock`.

---

## 12. Human Review Queue ([`artifacts/eval-integrity/human-review-queue.json`](../../artifacts/eval-integrity/human-review-queue.json))

Tổng **`5` ca** cần rà soát ngữ nghĩa thủ công (tránh chấm bằng string matching):
1. `SCENARIO-007` (`jacayl-ha-dong`, `pricing_time_packages`): Turn 2 khách hỏi tính/phụ thu qua đêm từ 22h, model trả quy định giờ/ân hạn mà chưa nêu bảng giá qua đêm.
2. `SCENARIO-014` (`jacayl-ha-dong`, `pricing_time_packages`): Tương tự `007` ở Turn 2.
3. `SCENARIO-490` (`j-village`, `booking_handoff_closing`): Kiểm tra độ tự nhiên & sắc thái bàn giao lễ tân.
4. `SCENARIO-495` (`j-village`, `booking_handoff_closing`): Kiểm tra độ tự nhiên & cách gắn link ảnh ở lượt chốt giữ phòng.
5. `SCENARIO-500` (`j-village`, `booking_handoff_closing`): Kiểm tra độ tự nhiên & sắc thái bàn giao lễ tân.

---

## 13. Candidate Commit & Rollback Plan

- **Candidate Branch:** `feat/v3-final-grounding-eval-hardening` (commit code & artifacts `16924a4`).
- **Frozen Production Baseline (Không bị thay đổi):** Nhánh `main` ở commit `dc11876`, tag `v3.0.0-final-policy-v1.4.6`, Dashboard daemon `task-6187` chạy bản build của `dc11876` tại `http://127.0.0.1:3000`.
- **Rollback Plan (khi cần quay lại hoặc hủy candidate):**
  ```powershell
  # Quay về bản đóng băng Pilot đang phục vụ Chủ dự án (0 downtime dataset/policy)
  git checkout v3.0.0-final-policy-v1.4.6
  # Hoặc chuyển về nhánh main tại dc11876
  git checkout main
  ```
- **Bước tiếp theo (chỉ khi Chủ dự án phê duyệt):** Cho phép build `dist/` mới từ candidate, replay Live trên các ca `SCENARIO-033`, `035`, `039`, `041` và chạy batch stratified 18 ca bằng Gemini & Groq dưới `FREE_ONLY_MODE=true`.
