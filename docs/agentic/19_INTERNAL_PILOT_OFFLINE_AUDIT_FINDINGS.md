# J COLLECTION — INTERNAL PILOT OFFLINE AUDIT FINDINGS
## Checkpoint Diversity, False-PASS Root Cause (`SCENARIO-033`), Failure Register & Evaluation Redesign

- **Baseline kiểm toán:** Architecture `Agentic V3.0 FINAL` · Business Policy `V1.4.6` · Commit `dc11876` · Tag `v3.0.0-final-policy-v1.4.6`
- **Phạm vi kiểm toán:** 100% **Offline & Read-only** trên [`artifacts/live-500-batches/live-500-checkpoint.json`](../../artifacts/live-500-batches/live-500-checkpoint.json), [`artifacts/autonomous-evaluation-v3/evaluation-results.json`](../../artifacts/autonomous-evaluation-v3/evaluation-results.json), [`src/agent/jcollection-agent.ts`](../../src/agent/jcollection-agent.ts), [`src/agent/agent-tools.ts`](../../src/agent/agent-tools.ts), [`src/conversation/grounding/claim-validator.ts`](../../src/conversation/grounding/claim-validator.ts), [`src/testing/lab/autonomous-customer-simulation-lab-v2-2.ts`](../../src/testing/lab/autonomous-customer-simulation-lab-v2-2.ts), [`scripts/live-500-batch-runner.ts`](../../scripts/live-500-batch-runner.ts) và [`data/jacayl-ha-dong.json`](../../data/jacayl-ha-dong.json).
- **Tuân thủ Freeze:** Không sửa source code, không sửa dataset/policy, không ghi đè benchmark gốc, không gọi thêm LLM và không khởi động lại Dashboard.

---

## 1. Independent Audit Findings — Thực trạng dữ liệu Checkpoint

Kiểm toán trực tiếp [`artifacts/live-500-batches/live-500-checkpoint.json`](../../artifacts/live-500-batches/live-500-checkpoint.json) xác nhận đầy đủ các con số sau:

| Chỉ số kiểm toán | Giá trị thực tế | Nhận xét kiểm toán |
|---|---:|---|
| Số Scenario ID duy nhất (`uniqueScenarioIds`) | **54** | 0 trùng lặp ID (`SCENARIO-001..042` + 12 mẫu baseline rải tới `500`) |
| Tổng lượt hội thoại (`totalTurns`) | **96** | Trung bình `1.78` lượt/kịch bản |
| Số lượt `LIVE_LLM_DECISION_VERIFIED` | **94** | Không chứng minh tính đúng sự thật của nội dung |
| Số lượt `BLOCKED` | **2** | `SCENARIO-032`, `SCENARIO-040` (nghẽn hạ tầng Free API ở Turn 1) |
| Câu mở đầu duy nhất sau khi bỏ hậu tố ID (`[ID-..]`, `[heldout_..]`, `(#..)`, `(..)`) | **16** | `54` kịch bản nhưng chỉ xoay quanh `16` mẫu câu mở đầu |
| Chuỗi tin nhắn khách duy nhất sau khi bỏ hậu tố ID | **25** | Độ lặp ngữ nghĩa rất cao |
| Tỷ lệ cơ sở `jacayl-ha-dong` | **48 / 54 (88.9%)** | `jacayl-tran-khat-chan`: **3**, `j-village`: **3** |
| Tỷ lệ nhóm `pricing_time_packages` | **45 / 54 (83.3%)** | `availability`: **3**, `advice`: **3**, `handoff`: **3**; **0** kịch bản cho `photos`, `amenities`, `requirement_context_changes`, `faq_policies` |
| Phân bố split (`discovery` / `held_out`) | **34 / 20** | — |
| Độ lặp trong batch `dc11876` (`SCENARIO-031..042`) | **12/12 Hà Đông · 11/12 câu mở đầu lặp lại** | Chỉ 1 biến thể `SCENARIO-040` chưa từng thấy ở batch cũ |

**Kết luận mục 1:** Tính duy nhất của `Scenario ID` không phản ánh độ đa dạng bài test. Việc runner duyệt tuần tự từ `SCENARIO-001` theo thứ tự bảng `categoryQuotas` đã vô tình dồn 54 kịch bản đầu vào `jacayl-ha-dong` + `pricing_time_packages` với câu hỏi lặp đi lặp lại.

---

## 2. Critical False-PASS Investigation — `SCENARIO-033` Turn 2

### Hiện tượng quan sát từ checkpoint
- **Kịch bản:** `SCENARIO-033` (`jacayl-ha-dong`, `discovery`, `pricing_time_packages`), Commit `dc11876`, Policy `V1.4.6`.
- **Turn 1 (`gemini:gemini-3.5-flash-lite`):** Khách hỏi *"gia nghi 4 tieng o hà đông tinh the nao shop? (#33)"*. Model gọi `["search_rooms", "get_policies", "quote_price", "quote_price", "quote_price"]` (lấy giá **4h nghỉ giờ**).
- **Turn 2 (`groq:qwen/qwen3.8-27b`, failover):** Khách hỏi *"Nếu mình lấy thêm gói qua đêm từ 22h ở Hà Đông thì phụ thu hay tính thế nào?"*.
  - `toolsExecuted: []`
  - Model trả lời: `Standard: 450.000đ`, `Deluxe: 590.000đ`, `Concept: 750.000đ` (trong khi canonical prices tại Hà Đông là **`420.000đ` / `560.000đ` / `700.000đ`**).
  - `verificationStatus: "LIVE_LLM_DECISION_VERIFIED"`, `rejectedClaims: []`, `businessPassed: true` -> đánh dấu `live_completed` (PASS)!

### Truy vết 8 lớp nguyên nhân gốc rễ trong source code

1. **Dữ kiện giá trong context Turn 2 (`buildLLMReasoningPrompt`, [`jcollection-agent.ts:2503-2567`](../../src/agent/jcollection-agent.ts#L2503-L2567)):**
   - Tham số `observations` truyền vào `buildLLMReasoningPrompt` chỉ là `turnObservations` của **lượt hiện tại**. Vì Turn 2 có `toolsExecuted: []`, `obsText` là `"None yet."`.
   - `priorHistory` (`state.conversationHistory.slice(-7, -1)`) chỉ chứa văn bản hội thoại khách/trợ lý. Tin nhắn trợ lý ở Turn 1 chỉ nêu giá 4 tiếng nghỉ giờ (`359k/479k/599k` và `380k/515k/649k`), **không hề chứa giá gói qua đêm**.
   - `systemPrompt` (`jcollection-agent.ts:2525-2547`) cố ý không nhúng bảng giá 66 phòng. Vì vậy khi Turn 2 bắt đầu, **không có bất kỳ dữ kiện giá qua đêm `420k/560k/700k` nào nằm trong context của `qwen/qwen3.8-27b`**.

2. **Điều kiện cho phép `RESPOND_DIRECTLY` ([`jcollection-agent.ts:1265-1316`](../../src/agent/jcollection-agent.ts#L1265-L1316) & [`2596-2647`](../../src/agent/jcollection-agent.ts#L2596-L2647)):**
   - `parseAndValidateLLMDecision()` chỉ xác thực schema JSON (`action`, `final_response.length >= 10`, không rò raw JSON/`<think>`/tên hàm tool).
   - Ở dòng `1265` & `1311-1316`, ngay khi model trả `action === 'RESPOND_DIRECTLY'` với `final_response` khác rỗng, vòng lặp `break` ngay ở iteration 1 mà **không có hậu kiểm** xem `final_response` có chứa số tiền VND / tên phòng trong khi `toolsExecuted` của lượt (hoặc trạng thái báo giá gói tương ứng) đang rỗng hay không.

3. **Claim extraction ([`claim-validator.ts:61-93`](../../src/conversation/grounding/claim-validator.ts#L61-L93)):**
   - `ClaimLevelValidator.validate()` chỉ dùng regex tách URL (`https?:\/\/...`) và số hotline (`0\d{3}\s?\d{3}\s?\d{3}`).
   - **Không có bộ trích xuất thực thể số tiền VND** (`\d[\d.]+\s*(đ|vnd|k)`), gói nghỉ (`nghi_gio` / `qua_dem` / `ngay_dem`), hoặc mã/số phòng (`Phòng 301`) trong văn bản đầu ra.

4. **Claim Validator ([`claim-validator.ts:30-449`](../../src/conversation/grounding/claim-validator.ts#L30-L449)):**
   - Toàn bộ phần thân `validate()` chỉ kiểm tra các cụm từ khóa vi phạm định sẵn (`đã đặt phòng thành công`, `24/7`, `king-size`, `bồn tắm đôi`, `trong ít phút`, `phụ thu ngày lễ`, `gói 1 tiếng`, `21h30 ... với giá qua đêm`, `tổng thống`, `50 shades`, `401`, 5 từ khóa phòng giả, `tt3-c19`, `50m`, `phòng tầng 4`, `bao gồm bữa sáng`).
   - Do chuỗi `Standard: 450.000đ / Deluxe: 590.000đ / Concept: 750.000đ` không chứa từ khóa cấm nào nên `rejectedClaims` trả về `[]`.

5. **Evidence binding & lỗi bỏ quên `expectedQuotes` ([`jcollection-agent.ts:1583-1589`](../../src/agent/jcollection-agent.ts#L1583-L1589) vs [`claim-validator.ts:22-30`](../../src/conversation/grounding/claim-validator.ts#L22-L30)):**
   - `jcollection-agent.ts` có truyền `expectedQuotes: quoteResultsRecord.filter(...).map(...)` vào `claimValidator.validate()`.
   - Tuy nhiên trong `claim-validator.ts`, **`context.expectedQuotes` hoàn toàn không được tham chiếu ở bất kỳ dòng nào**. Đồng thời tại `SCENARIO-033` Turn 2, vì model không gọi `quote_price`, `quoteResultsRecord` bản thân cũng bằng `[]`. Việc `evidenceCitations` rỗng (`[]`) khi phát ngôn có số tiền cũng không kích hoạt cảnh báo thiếu bằng chứng.

6. **Final response validation & ý nghĩa thực của `LIVE_LLM_DECISION_VERIFIED` ([`jcollection-agent.ts:1592-1601`](../../src/agent/jcollection-agent.ts#L1592-L1601)):**
   - `const isTrueLiveLLMControlled = usedLiveLLM && usedModelResponse && !fallbackHappened;`
   - Trạng thái `LIVE_LLM_DECISION_VERIFIED` **chỉ khẳng định một điều duy nhất:** một provider LLM thật (không phải mock hay deterministic fallback) đã tự xuất JSON hợp lệ chọn `RESPOND_DIRECTLY` / `CLARIFY` / `ESCALATE`. Nó **không** chứng minh phản hồi đã gọi tool, có evidence grounding hay đúng biểu giá.

7. **Business evaluator ([`autonomous-customer-simulation-lab-v2-2.ts:598-682`](../../src/testing/lab/autonomous-customer-simulation-lab-v2-2.ts#L598-L682) & [`scripts/live-500-batch-runner.ts:211-213`](../../scripts/live-500-batch-runner.ts#L211-L213)):**
   - `DeterministicBusinessEvaluatorV22.evaluateInvariants()` chỉ kiểm tra 7 quy tắc chuỗi hẹp (token `undefined/NaN`, cross-property string, `21:00 qua đêm`, `có bếp`/`pccc`, `bồn tắm đôi`, `chắc chắn còn phòng`, `'xem ảnh'`).
   - Evaluator này **không kiểm tra số tiền**, **không đối chiếu `scenario.turnSpecs[i].expectedTools`** (`quote_price`), và `live-500-batch-runner.ts` không chạy `SemanticConversationEvaluatorV22`. Do đó câu trả lời sai toàn bộ 3 mức giá qua đêm vẫn nhận `businessPassed: true`.

**Tóm tắt nguyên nhân gốc rễ:** Không phải lỗi của Pricing Engine (Pricing Engine không được gọi trong Turn 2), mà là sự kết hợp của: *(i)* `qwen/qwen3.8-27b` trả lời trực tiếp bằng phỏng đoán khi context Turn 2 không có giá qua đêm; *(ii)* lớp thực thi cho phép `RESPOND_DIRECTLY` phát số tiền VND mà không kiểm tra price grounding; *(iii)* `ClaimLevelValidator` bỏ qua `expectedQuotes`, số tiền VND và mã phòng thực; và *(iv)* `live-500-batch-runner` dùng bộ lọc chuỗi hẹp `evaluateInvariants()` để chấm PASS.

---

## 3. Additional Failure Register (Phân biệt Lịch sử vs Commit `dc11876`)

| Scenario (Turn) | Phân hệ / Commit | Provider / Model | `toolsExecuted` | Lỗi thực tế (False PASS / Quality Gap) | Nguyên nhân & Lý do lọt qua Validator/Evaluator |
|---|---|---|---|---|---|
| **`SCENARIO-009` (T1)** | **Lịch sử** (`v3_0_final_pilot_batch_1`, pre-`dc11876`) | `gemini:gemini-3.1-flash-lite` | `["quote_price", "search_rooms", "quote_price"]` | **Sai tổng giá nghỉ 4h:** ghi Standard `159k + 2h = 259.000đ` (đúng: `359k`), Deluxe `279k + 2h = 379.000đ` (đúng: `479k`); chỉ Concept `599k` đúng. | Model cộng sai nhẩm `159 + 100` thay vì `159 + 200`; `ClaimValidator` không đọc `expectedQuotes` để đối chiếu số tiền đầu ra với `quote_price`. |
| **`SCENARIO-018` (T2)** | **Lịch sử** (`v3_0_final_pilot_batch_1`, pre-`dc11876`) | `groq:openai/gpt-oss-20b` *(model cũ đã loại khỏi routing mặc định)* | `["quote_price", "get_policies", "search_rooms", "get_policies"]` | **Thiếu đơn vị hàng nghìn & sai rate phát sinh:** ghi Deluxe `560 đ`, Concept `700 đ` (thiếu `.000`), và nêu nhầm giá phát sinh thêm giờ bằng giá 2h (`159k/279k/399k`). | Lỗi sinh token của `gpt-oss-20b`; `ClaimValidator` không kiểm tra ngưỡng hợp lý VND (`< 10.000đ`) hay `extra_hour_rate` thực (`100k/200k`). |
| **`SCENARIO-027` (T1–T2)** | **Lịch sử** (`v3_0_final_pilot_batch_1`, pre-`dc11876`) | `gemini:gemini-3.1-flash-lite` | T1: `["quote_price", "search_rooms"]`<br>T2: `["quote_price", "get_policies", "search_rooms", "get_policies"]` | **T1 thiếu tổng 4h** (chỉ ghi `159k/279k/399k + sẽ có phụ phí`); **T2 sai chính sách gói lưu trú:** nói nhận `18:00/20:00` rồi ở qua đêm sẽ *"tính nghỉ giờ trước đó, sau đó chuyển sang qua đêm"* thay vì áp dụng gói **`ngay_dem`** (`14:00–21:39`). | Model tự diễn giải quy tắc ghép gói thay vì đối chiếu `stay_package_eligibility`; `ClaimValidator` §6.4 chỉ chặn cụm `"với giá qua đêm"`, không chặn diễn giải sai `nghỉ giờ + qua đêm` cho khung `14:00–21:39`. |
| **`SCENARIO-120` (T3)** | **Lịch sử** (`baseline_v3_0_12`, pre-`dc11876`) | `groq:qwen/qwen3.8-27b` | `[]` | **Gửi ảnh dạng text link thay vì media UI:** khách hỏi *"Gửi giúp mình ảnh chụp thực tế góc phòng này"*, AI dán 3 URL `.webp` vào text nhưng `deliveredMedia: []`. | `buildLLMReasoningPrompt:2551` hiển thị `[photos sent]` trong `lastPresentedRooms` và `conversationHistory` từ Turn 2 chứa sẵn R2 URLs -> Turn 3 bỏ gọi `get_room_media`. Evaluator Invariant 6 (`line 668`) chỉ khớp literal `'xem ảnh'`/`'xem hinh'`, bỏ lọt `'ảnh chụp thực tế'`. |
| **`SCENARIO-033` (T2)** | **Commit hiện tại `dc11876`** (Policy `V1.4.6`) | `groq:qwen/qwen3.8-27b` (`isFallback: true`) | `[]` | **Báo giá qua đêm không căn cứ & sai sự thật:** `Standard 450k / Deluxe 590k / Concept 750k` (đúng: `420k / 560k / 700k`). | Xem chi tiết Mục 2 (`RESPOND_DIRECTLY` không bị chặn khi thiếu price observation + `ClaimValidator` không kiểm VND/evidence). |
| **`SCENARIO-035` (T1)** | **Commit hiện tại `dc11876`** (Policy `V1.4.6`) | `gemini:gemini-3.5-flash-lite` | `["search_rooms", "quote_price", "quote_price", "quote_price"]` | **Tự giả định giờ check-in `14:00`:** khách chỉ hỏi *"4 tiếng tại Hà Đông chiều nay"*, AI đáp *"từ 14:00 chiều nay"* và chỉ báo khung ban ngày (`380k/515k/649k`). | **Temporal fixture bias + prompt anchoring:** [`live-500-batch-runner.ts:73`](../../scripts/live-500-batch-runner.ts#L73) & [`autonomous-customer-simulation-lab-v2-2.ts:846`](../../src/testing/lab/autonomous-customer-simulation-lab-v2-2.ts#L846) cố định `fixedClock = '2026-11-28T14:00:00+07:00'` (Thứ Bảy `14:00`). Model lấy `Current Local Time: 14:00` làm giờ nhận phòng dù khách không xác nhận `14:00` (cũng tiềm ẩn lệch nếu *"chiều nay"* kéo sang khung tối `>= 18:00`). |
| **`SCENARIO-039` (T1)** | **Commit hiện tại `dc11876`** (Policy `V1.4.6`) | `gemini:gemini-3.5-flash-lite` | `["search_rooms"]` | **Chưa hoàn thành yêu cầu báo giá 4h:** không gọi `quote_price`, chỉ báo giá 2h đầu (`159k/279k/399k`) và *"tính theo quy định phụ thu giờ"*. | `search_rooms` không trả giá 4h tính sẵn; model dừng sớm với `RESPOND_DIRECTLY` mà không gọi `quote_price`; evaluator không kiểm tra `expectedTools` hoặc goal completion `QUOTE_PRICE`. |
| **`SCENARIO-041` (T1)** | **Commit hiện tại `dc11876`** (Policy `V1.4.6`) | `groq:qwen/qwen3.8-27b` (`isFallback: true`) | `[]` | **Gợi ý phòng không tồn tại ở Hà Đông:** *(Ví dụ: Phòng 101, 201, **301**...)* — kiểm tra [`data/jacayl-ha-dong.json`](../../data/jacayl-ha-dong.json) xác nhận tầng 3 Hà Đông bắt đầu từ `302-barbie-bedroom`, **không có phòng `301`**. | Model tự suy đoán dãy số tuần tự khi `toolsExecuted: []`; `ClaimValidator` §7.4 chỉ chặn 5 tên phòng giả lịch sử, không đối chiếu số phòng được nhắc với danh sách `dataset.phong` thực của cơ sở. |

*Ghi nhận thêm khi rà toàn bộ 12 ca `dc11876`:* Ngoài các ca nêu trên, `SCENARIO-037` cũng quy mặc định *"Nghỉ 4 tiếng cơ sở Hà Đông"* vào khung ban ngày cuối tuần (`380k/515k/649k`) do neo theo `fixedClock` Thứ Bảy; `SCENARIO-036` Turn 2 chỉ gọi `get_policies` mà chưa nêu giá qua đêm.

---

## 4. Evaluation Integrity — Tách bạch 8 Trục Đánh Giá & Trạng Thái

Không sử dụng `rejectedClaims === []`, `LIVE_LLM_DECISION_VERIFIED`, hoặc `businessPassed` của 7 invariant chuỗi làm thước đo duy nhất. Cần tách rõ hai tầng trạng thái:

- **`execution_status` (`live_completed` | `live_blocked` | `live_failed`):** Phản ánh kỹ thuật chạy thật có hoàn tất hợp đồng JSON dưới `strictLiveOnly` mà không bị 429/503/timeout chặn hay không.
- **`quality_passed` (`true` | `false`):** Chỉ `true` khi đạt ngưỡng trên cả **8 trục đánh giá độc lập** (có thể chấm hoàn toàn **offline** bằng script kiểm toán trên transcript đã lưu):

| # | Trục đánh giá | Tiêu chí đo lường cụ thể | Điều kiện FAIL / Giáng cấp |
|---|---|---|---|
| 1 | **Execution success** | Có chạy live không rơi vào `BLOCKED` / `DEGRADED_DETERMINISTIC_MODE`, `parseAndValidateLLMDecision` thành công. | Lượt `BLOCKED` hoặc fallback deterministic. |
| 2 | **Business factual accuracy** | Mọi con số VND, phụ thu, đơn vị (`>= 10.000đ`), tên/mã phòng (`∈ dataset.phong[facility]`), và quy tắc gói (`nghi_gio`/`qua_dem`/`ngay_dem`/V1.4.6) khớp 100% ground truth. | Bịa giá (`033`), sai tổng (`009`), cụt `000đ` (`018`), phòng `301` (`041`), sai gói (`027`). |
| 3 | **Evidence grounding** | Mọi phát ngôn chứa giá VND, số phòng cụ thể, tiện nghi hoặc ảnh phải truy nguyên được về `toolsExecuted` + observation hợp lệ (chỉ miễn khi là câu hỏi thuần chính sách đã cố định ở invariant nếu không nêu bảng giá phòng cụ thể). | Báo bảng giá với `toolsExecuted: []` (`033` T2) hoặc tự bịa mã phòng (`041`). |
| 4 | **Goal completion** | Trả lời trọn vẹn yêu cầu chính (vd. hỏi 4h phải ra tổng 4h hoặc hai nhánh điều kiện rõ ràng chứ không chỉ đưa giá 2h). | Chỉ đưa giá 2h khi khách hỏi 4h (`039`). |
| 5 | **Context understanding** | Giữ đúng ràng buộc đa lượt, xử lý câu hỏi phụ tiếp nối, và **không** tự biến `referenceClock` thành giờ khách đặt khi khách chỉ nói buổi chung chung (`035`). | Giả định cứng `14:00` từ `fixedClock` hoặc quên ràng buộc vừa thay đổi. |
| 6 | **Naturalness & conciseness** | Trả lời tự nhiên bằng tiếng Việt, không lặp boilerplate địa chỉ/hotline máy móc, độ dài vừa phải (`<= 950` ký tự trừ bảng đa phòng). | Dán raw markdown URL khi đã có album hoặc văn phong robot. |
| 7 | **Media delivery** | Khi khách yêu cầu xem ảnh / gửi ảnh (mọi cách diễn đạt tự nhiên, kể cả ở lượt sau), `deliveredMedia` / `room_presentations` phải có ảnh hợp lệ từ `get_room_media`. | Dán URL dạng text nhưng `deliveredMedia: []` (`120` T3). |
| 8 | **Operational reliability** | Theo dõi `latency_ms` (`avg`/`p50`/`p95`), số `http429`/`http503`/timeout, tỷ lệ `providerFailovers`, `formatRepairs`, `degradedModeTurns`. | Báo cáo tách biệt hạ tầng Free API khỏi chất lượng trí tuệ Agent. |

---

## 5. Live 500 Sampling Review — Chiến lược chọn mẫu tiếp theo (Chưa chạy ngay)

### Bức tranh 448 kịch bản còn lại (446 chưa chạy + 2 `BLOCKED`)
Từ [`evaluation-results.json`](../../artifacts/autonomous-evaluation-v3/evaluation-results.json) & checkpoint:
- **Theo cơ sở:** Hà Đông `154`, Trần Khát Chân `147`, J Village `147`.
- **Theo nhóm nhu cầu:**
  - Chưa kiểm thử Live 500 chút nào (`0` đã xong): `photos_room_selection` (`75`), `amenities_features` (`65`), `requirement_context_changes` (`50`), `faq_policies` (`40`).
  - Đã có rất ít mẫu: `advice_preferences_budget` (`62` còn lại), `booking_handoff_closing` (`27` còn lại), `availability_catalog_categories` (`77` còn lại), `pricing_time_packages` (`52` còn lại — gồm `032`, `040`).
- **Theo số lượt & split:** `325` single-turn, `101` 2-turn, `22` 3-turn; `367` `discovery`, `81` `held_out`.

### Phương án lấy mẫu phân tầng (Stratified Sampling) khi Chủ dự án cho phép
Giữ nguyên 100% file `AutonomousScenarioCatalogV22` (500 kịch bản gốc) và baseline cũ để so sánh lịch sử, đồng thời bổ sung tham số lọc/chọn mẫu cho runner (ví dụ chọn 1 batch ~`18–24` kịch bản đại diện đa tầng thay vì cắt `slice(0, batchSize)` tuần tự):
1. **Phủ đều 3 cơ sở:** Mỗi batch `18` ca lấy `6` Hà Đông + `6` Trần Khát Chân + `6` J Village (ưu tiên 2 cơ sở đang thiếu `TKC` và `J Village`).
2. **Ưu tiên nhóm 0% độ phủ trước:** Dành tối thiểu `70%` chỉ tiêu batch cho 4 nhóm chưa có mẫu (`photos_room_selection`, `amenities_features`, `requirement_context_changes`, `faq_policies`) và nhóm đa lượt (`2–3` turns) + `held_out`.
3. **Chống lặp ngữ nghĩa:** Deduplicate theo câu hỏi đã bỏ hậu tố ID trong phạm vi 1 batch để tránh chạy 5 lần cùng một câu mở đầu.
4. **Đa dạng hóa Temporal Fixture:** Xoay vòng ít nhất 4 mốc `referenceClock` cố định có ghi vết (`weekday_morning 07:30`, `weekday_afternoon 15:00`, `weekend_evening 18:10`, `night_grace 21:45`) thay vì chỉ một mốc Thứ Bảy `14:00` như hiện tại.

---

## 6. Proposed General-Purpose Improvements (Đề xuất kiến trúc — Chưa triển khai)

Các đề xuất dưới đây hoàn toàn giữ nguyên lõi *Reasoning-first · Tool-driven · Business-controlled*, không thêm Intent Router, không viết regex nhận diện câu hỏi khách, không hardcode bảng giá vào Agent và không mở rộng deterministic fallback:

1. **Tool-Evidence Precondition cho `RESPOND_DIRECTLY` chứa thực thể giá/phòng:**
   - Trước khi chấp nhận kết thúc lượt với `action="RESPOND_DIRECTLY"`, kiểm tra tổng quát ở cấp thực thể: nếu `final_response` nhắc tới bất kỳ mức giá VND cụ thể hoặc liệt kê mã/số phòng mà trong lượt hiện tại (hoặc `quoteResultsRecord` / `searchResultRecord` phù hợp ngữ cảnh phiên) chưa có observation xác thực tương ứng -> yêu cầu chính LLM tự thực hiện 1 bước gọi tool (`CALL_TOOLS`) trong giới hạn `maxIterations` hiện có thay vì phát ra giá phỏng đoán (giải quyết chung gốc lỗi kiểu `SCENARIO-033` Turn 2, `039`, `041`).
2. **Kích hoạt đối chiếu số liệu thật trong `ClaimLevelValidator`:**
   - Sử dụng `context.expectedQuotes` (hiện đang truyền vào nhưng bị bỏ không) và dữ liệu `dataset.phong` + `dataset.co_so` cho `context.facility` để:
     - Phát hiện mã phòng được khẳng định tồn tại nhưng không có trong `dataset.phong` của cơ sở (chặn tự bịa phòng `301` Hà Đông).
     - Kiểm tra các số tiền VND xuất hiện trong phản hồi: phát hiện con số bất thường thiếu đơn vị (`< 10.000đ` như `560 đ`) và kiểm tra tính nhất quán với `expectedQuotes` / bảng giá canonical của hạng phòng đang nói tới trong context (chặn lỗi cộng sai `259k`/`379k` ở `009` hay bịa `450k/590k/750k` ở `033`).
3. **Đồng bộ Media Delivery cho lượt yêu cầu ảnh kế tiếp:**
   - Tách rõ trạng thái *"đã từng gắn media ở lượt trước"* khỏi *"khách yêu cầu gửi lại ảnh ở lượt hiện tại"*: khi ở `Turn k` model quyết định dùng lại ảnh của phòng đã gắn `lastPresentedRooms` (hoặc gọi `get_room_media` lại), backend bảo đảm gắn lại cấu trúc `deliveredImages` / `room_presentations` đúng của phòng đó thay vì để model dán link R2 thô với `deliveredMedia: []` (`SCENARIO-120` Turn 3).
4. **Làm rõ ranh giới Temporal Context trong prompt ngữ nghĩa:**
   - Ở `buildLLMReasoningPrompt`, nhấn mạnh tách biệt `Message Received Timestamp` với *"khách chỉ nói buổi chung chung (`chiều nay`, `tối nay`)"*: không chép giờ của đồng hồ hệ thống (`14:00`) vào làm giờ nhận phòng xác nhận của khách; với Hà Đông khi chỉ có buổi chiều mà không rõ trước/sau `18:00`, dùng nhánh báo giá có điều kiện từ `quote_price`.
5. **Tách `live_completed` khỏi `quality_passed` & chạy bộ chấm offline 8 trục:**
   - Áp dụng bộ chấm 8 trục (Mục 4) chạy offline trực tiếp lên 96 lượt đã lưu để phân loại lại chính xác `quality_passed` trên 54 kịch bản baseline mà không tốn thêm 1 API call nào.

---

> **Trạng thái hiện tại:** Commit `dc11876` (Tag `v3.0.0-final-policy-v1.4.6`) và Staff Dashboard `http://127.0.0.1:3000` được bảo toàn nguyên trạng. Chờ quyết định phê duyệt của Chủ dự án trước khi triển khai bất kỳ thay đổi mã nguồn nào từ Mục 4–6.
