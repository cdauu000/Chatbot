# J COLLECTION — PHASE 0: SOURCE CODE REALITY AUDIT
**Định hướng:** Reasoning-first · Tool-driven · Business-controlled  
**Ngày kiểm toán:** 23/11/2026  
**Repository:** `C:\Chatbot`  
**Đối tượng kiểm toán:** Toàn bộ kiến trúc thực thi hội thoại M4.3  

---

## I. MỤC TIÊU & PHƯƠNG PHÁP KIỂM TOÁN

Kiểm toán trực tiếp mã nguồn thực tế và runtime trace của hệ thống hội thoại J Collection M4.3, đối chiếu 10 câu hỏi cốt lõi về bản chất vận hành: hệ thống đang là **Rule-centric Pipeline** hay **Agentic AI System**.

Tất cả kết luận được chứng minh bằng đường dẫn file, số dòng (`file:line`), call path và bằng chứng thực thi thực tế.

---

## II. 10 CÂU HỎI KIỂM TOÁN NGUỒN CỐT LÕI

### 1. Tin nhắn khách đi qua những module nào trước khi tạo phản hồi?
**Bằng chứng mã nguồn & Runtime Call Path:**
1. **Entry Point:** Khách gửi tin qua Chat CLI (`src/demo/chat-cli.ts:60`) hoặc Staff Dashboard REST API (`src/staff/server/dashboard-server.ts:215`).
2. **Orchestrator Entry:** `ConversationOrchestrator.processTurn(sessionId, userMessage, optionsOrClock, propertyId)` (`src/conversation/orchestrator.ts:121`).
3. **Session Retrieval:** `MemoryManager.getSession(sessionId)` (`src/conversation/memory-manager.ts:35`).
4. **Context Property Binding:** Server-side binding cơ sở nếu có `boundPropertyId` (`src/conversation/orchestrator.ts:153-156`).
5. **NLU Intent & Slot Extraction:** `LLMAdapter.parseIntentAndEntities` (`src/conversation/adapters/free-llm-gateway.ts:230` hoặc `mock-llm-adapter.ts:20`):
   - Chạy qua `DataClassificationGate.classify` & `PIIRedactionLayer.redact` (`src/conversation/privacy/pii-redaction.ts:40, 120`).
   - Gọi Groq/Gemini HTTP API (`src/conversation/adapters/groq-provider.ts:87`, `gemini-provider.ts:89`) hoặc fallback về `NLUEngine.parse` (`src/conversation/nlu-engine.ts:30`).
6. **Constraint Mutation:** `MemoryManager.removeRequirement / negateRequirement / clearNegation` (`src/conversation/orchestrator.ts:169-195`).
7. **Reference Resolution:** `RoomReferenceResolver.resolve` (`src/conversation/reference-resolver.ts:50`).
8. **Slot Persistence:** `MemoryManager.updateSlots` (`src/conversation/orchestrator.ts:279`).
9. **Policy Match Check:** `PolicyQAEngine.answer` (`src/knowledge/policy-qa-engine.ts:25`).
10. **Fast-path & Conversation Planning:** `AIConversationPlanner.plan` (`src/conversation/planning/conversation-planner.ts:28`).
11. **Context Retraction on Topic Shift:** `MemoryManager.invalidateContext` (`src/conversation/orchestrator.ts:325`).
12. **Action Determination Ladder:** Chuỗi `if / else if` cố định xác định `chosenAction` (`src/conversation/orchestrator.ts:342-427`).
13. **Stay Package Eligibility:** `StayPackageEligibilityResolver.resolve` (`src/pricing/stay-package-eligibility.ts:50`).
14. **Deterministic Tool Invocations:**
    - `InMemoryRoomSearchEngine.search` (`src/search/in-memory-room-search.ts:60`).
    - `PreBookingQuoteEngine.getQuote` (`src/pricing/prebooking-quote-engine.ts:40`).
15. **Grounded Answer Planning:** `GroundedAnswerPlanner.plan` (`src/conversation/grounding/grounded-answer-planner.ts:39`).
16. **Response Generation:** `LLMAdapter.composeAdvisoryResponse` (`src/conversation/adapters/free-llm-gateway.ts:462`), gọi trực tiếp `AdvisoryComposer.compose` (`src/conversation/advisory-composer.ts:74`).
17. **Claim-Level Grounding Validation:** `ClaimLevelValidator.validate` (`src/conversation/grounding/claim-validator.ts:21`).
18. **Turn Recording & Output:** `MemoryManager.addTurn` (`src/conversation/memory-manager.ts:100`), trả về `ConversationTurnResult`.

---

### 2. Groq/Gemini đang thực sự quyết định những gì?
**Bằng chứng mã nguồn:**
- Tại `src/conversation/adapters/free-llm-gateway.ts` (dòng 255–270), prompt gửi tới Groq/Gemini chỉ yêu cầu trích xuất JSON theo `LLMStructuredOutputSchema` (`intent`, `facility`, `room_name`, `stay_type`, `duration_hours`, `budget`, `must_have_amenities`, `removed_requirements`, `negated_constraints`, `cleared_negations`, `confidence`).
- Tại `src/conversation/adapters/free-llm-gateway.ts` (dòng 462–464):
  ```typescript
  public async composeAdvisoryResponse(params: ComposeAdvisoryParams): Promise<string> {
    return this.composer.compose(params);
  }
  ```
- **Kết luận xác minh:** Groq/Gemini **chỉ được dùng làm bộ bóc tách ngữ nghĩa JSON (Slot/Intent Parser)**. Mô hình LLM **hoàn toàn không được tham gia quyết định hành động**, không được chọn tool và **không được viết bất kỳ câu trả lời nào gửi cho khách**.

---

### 3. Phần nào do regex, intent router và template quyết định?
**Bằng chứng mã nguồn:**
1. **Regex & Keyword Heuristics:**
   - `src/conversation/nlu-engine.ts` (dòng 38–150): Toàn bộ intent router fallback dựa trên 11 hàm regex/từ khóa cứng (`isAdversarial`, `isAIIdentityInquiry`, `isInStayOperationalRequest`, `isCheckoutDispute`, `isHumanRequest`, `isBookingIntent`, `isParkingInquiry`, `isRoomAvailabilityInquiry`, `isSpecificRoomPriceInquiry`, `isCategoryPriceInquiry`).
2. **Deterministic Fast Path Planner:**
   - `src/conversation/planning/conversation-planner.ts` (dòng 45–150): Bắt cứng các tình huống chào hỏi (`isPoliteClosing`), phục vụ phòng (`isInStayRequest`), khiếu nại (`isCheckoutDispute`), đỗ xe (`isPureParkingInquiry`).
3. **Intent Router Ladder:**
   - `src/conversation/orchestrator.ts` (dòng 342–427): Một thang `if / else if` gồm 85 dòng lệnh quyết định `chosenAction` dựa trên biến enum `intent` và `plan.primaryGoal`.
4. **Response Templates:**
   - `src/conversation/advisory-composer.ts` (dòng 74–717): 100% câu chữ gửi khách hàng được ghép từ các chuỗi mẫu TypeScript (template strings) ứng với từng `action`.

---

### 4. LLM có được quyền đề xuất tool call hay không?
**Bằng chứng mã nguồn:**
- Tại `src/conversation/adapters/free-llm-gateway.ts` (dòng 12–100), `LLMStructuredOutputSchema` không có bất kỳ thuộc tính nào cho `tool_calls`, `function_call` hay `proposed_actions`.
- **Kết luận xác minh:** **KHÔNG.** LLM không có quyền và không có giao thức để đề xuất gọi công cụ. Mọi công cụ do `orchestrator.ts` tự quyết định gọi sau thang `if / else if`.

---

### 5. Tool call có được schema validation và kiểm tra quyền ở backend không?
**Bằng chứng mã nguồn:**
- Vì LLM không được đề xuất tool call, nên hệ thống M4.3 **không có Tool Gateway runtime** để validate schema tool call do LLM phát sinh.
- Các hàm nội bộ (`searchEngine.search`, `quoteEngine.getQuote`) chỉ nhận TypeScript parameters cục bộ do orchestrator truyền vào.
- **Kết luận xác minh:** Chưa có Tool Gateway dành cho Agent.

---

### 6. Có vòng Decision → Tool → Observation → Revised Decision hay không?
**Bằng chứng mã nguồn:**
- Tại `src/conversation/orchestrator.ts` (dòng 121–806): Luồng xử lý hoàn toàn là **single-pass pipeline (thác nước đơn hướng)**.
- Khi Search Engine trả về 0 kết quả phù hợp ngân sách, hệ thống không cấp kết quả này lại cho LLM để suy luận lại (re-plan), mà chỉ đẩy qua `GroundedAnswerPlanner` để ghép văn bản giải thích ngân sách thiếu.
- **Kết luận xác minh:** **KHÔNG CÓ.** Hoàn toàn không có vòng lặp suy luận - hành động - quan sát.

---

### 7. Có xử lý tool trả kết quả rỗng, lỗi, thiếu dữ liệu hoặc mâu thuẫn không?
**Bằng chứng mã nguồn:**
- Kết quả rỗng của tìm kiếm phòng được phân rã thành `partial_matches` hoặc `alternative_suggestions` bằng thuật toán tính điểm cứng trong `src/search/in-memory-room-search.ts`.
- Thiếu ngân sách được tính bằng công thức toán học trừ delta trong `src/conversation/grounding/grounded-answer-planner.ts:54-66`.
- Lỗi kết nối provider LLM được bắt bằng try/catch fallback tuần tự (Groq -> Gemini -> Mock).
- **Kết luận xác minh:** Xử lý bằng code cố định cục bộ, **không có cơ chế Agentic Re-planning** khi gặp dữ liệu mâu thuẫn hay thiếu sót.

---

### 8. Working Memory có hỗ trợ sửa ràng buộc và invalidate kết quả cũ không?
**Bằng chứng mã nguồn:**
- `src/conversation/memory-manager.ts` (dòng 150–250): Có các hàm `invalidateContext`, `removeRequirement`, `negateRequirement`, `clearNegation` lưu trong state bộ nhớ.
- `src/conversation/orchestrator.ts` (dòng 325–332): Khi `plan.topicChanged && plan.clearPreviousRequirements`, orchestrator gọi `memoryManager.invalidateContext(sessionId, { clearRequirements: true, clearShortlist: true })`.
- **Kết luận xác minh:** **CÓ HỖ TRỢ một phần ở tầng slot bộ nhớ cố định**, nhưng chưa hỗ trợ Invalidation trên đồ thị niềm tin (Belief Graph) và các suy luận phụ thuộc trước đó.

---

### 9. Claim Validator có kiểm tra từng khẳng định quan trọng dựa trên evidence không?
**Bằng chứng mã nguồn:**
- `src/conversation/grounding/claim-validator.ts` (dòng 21–364): Kiểm tra kiểm soát chặt chẽ câu trả lời:
  - Chặn cam kết đặt phòng giả mạo (`REJECTED_FAKE_BOOKING_CONFIRMATION`, dòng 45).
  - Chặn khẳng định trực 24/7 không có nguồn (`REJECTED_UNVERIFIED_247_CLAIM`, dòng 52).
  - Chặn URL ngoài dataset (`REJECTED_UNSOURCED_URL`, dòng 69).
  - Chặn số điện thoại lạ (`REJECTED_UNSOURCED_HOTLINE`, dòng 83).
  - Chặn tự tiện khẳng định máy chiếu/bồn tắm đôi/giường king-size (`REJECTED_UNVERIFIED_AMENITY_ASSERTION`, dòng 100, 120, 123).
  - Chặn bịa đặt phụ thu ngày lễ (`Business Policy V1.4.3`, dòng 146–160).
- **Kết luận xác minh:** **CÓ.** Đây là thành phần Business Control cực kỳ giá trị, hoàn toàn có thể tái sử dụng làm Response Guard cho Agentic System.

---

### 10. Những thành phần nào có thể tái sử dụng mà không cần refactor?
**Danh sách thành phần tái sử dụng nguyên vẹn:**
1. **Canonical Dataset:** `data/j_collection_dataset.json` (66 phòng, 3 cơ sở).
2. **Domain Transformer & Evidence Typing:** `src/domain/transformer.ts`, `src/domain/normalized-schema.ts`, `src/domain/evidence.ts`.
3. **Authoritative Pricing Engine:** `src/pricing/prebooking-quote-engine.ts`, `src/pricing/checkin-pricing-resolver.ts`, `src/pricing/automated-pricing-oracle.ts`.
4. **Business Policy V1.4.3 Rules & Eligibility:** `src/pricing/stay-package-eligibility.ts`, `data/j_collection_business_policy_v1_4_3.json`.
5. **Room Search Engine:** `src/search/in-memory-room-search.ts`.
6. **Knowledge Base & Policy Retrieval:** `src/knowledge/knowledge-base.ts`, `src/knowledge/policy-qa-engine.ts`.
7. **Free LLM Provider Adapters:** `src/conversation/adapters/groq-provider.ts`, `gemini-provider.ts`, `free-llm-gateway.ts`.
8. **Staff Dashboard & Concurrency Management:** `src/staff/persistence/sqlite-store.ts`, `src/staff/auth/access-control.ts`, `src/staff/takeover/takeover-coordinator.ts`, `src/staff/server/dashboard-server.ts`.
9. **Claim Grounding Validator:** `src/conversation/grounding/claim-validator.ts`.

---

## III. PHASE 0A: CRITICAL GROUND TRUTH CHECK

Kiểm tra đối soát trực tiếp các dữ kiện nghiệp vụ từ dữ liệu JSON gốc:

| Hạng mục kiểm tra | Giá trị Ground Truth trong JSON | Sai lệch trong báo cáo M4.3 / Hệ thống cũ | Kết luận chính thức |
|---|---|---|---|
| **Phòng 601 Hà Đông (Bồn tắm)** | `data/jacayl-ha-dong.json` dòng 1421: `"tien_nghi_nguyen_van": ["Bồn tắm lớn", "Ghế tình yêu"]`. Hoàn toàn **không có số đo kích thước**. | Một số prompt/test tự gán "dài 1,7–1,8 m" hoặc suy diễn thành "bồn tắm đôi". | **Chỉ có nhãn "Bồn tắm lớn"**. Mọi khẳng định về kích thước mét là hallucination. |
| **Jacuzzi toàn chuỗi** | Toàn bộ 66 phòng trong `data/j_collection_dataset.json` và Business Policy **không nhắc tới từ khóa "Jacuzzi" hay "bồn sục"**. | Hệ thống cũ khẳng định câu: *"khách sạn không có bồn sục Jacuzzi"*. | Chưa có văn bản của chủ chuỗi xác nhận không có. Trạng thái đúng là **`UNKNOWN` (chưa có nguồn xác nhận)**, không được biến thành khẳng định phủ định `FALSE`. |
| **Giá ngày đêm Phòng 202 Hà Đông** | `data/jacayl-ha-dong.json` dòng 149 và `data/j_collection_dataset.json` dòng 148: `"ngay_dem": 650000`. | Báo cáo M4.2.1 ghi đúng `650.000đ`. Báo cáo M4.3 bảng tổng hợp (dòng 67) ghi nhầm thành `690.000đ`. | Giá chuẩn xác thực là **650.000đ**. Con số 690.000đ là lỗi typo gõ nhầm bảng của báo cáo M4.3. |
| **Danh sách phòng có bồn tắm trên toàn chuỗi** | Tổng cộng đúng **5 phòng** có `bon_tam.status = CONFIRMED_TRUE`: <br>1. Hà Đông: `101-long-chim` (Concept), `601-50-sac-thai` (Concept), `602-playboy` (Concept)<br>2. TKC: `1001-dem` (VIP Signature)<br>3. J Village: `crimson-suite` (Suite) | Một số tài liệu cũ ghi rải rác hoặc nhầm phòng Standard/Deluxe có bồn tắm. | Xác thực chính xác **5 phòng** trên toàn hệ thống 3 cơ sở. |
| **Kỷ luật dữ liệu** | Giữ nguyên 100% dữ liệu gốc trong `data/j_collection_dataset.json` và `data/j_collection_business_policy_v1_4_3.json`. | Không can thiệp, không sửa dữ liệu canonical để làm giả kết quả test. | **TUÂN THỦ TUYỆT ĐỐI**. |
