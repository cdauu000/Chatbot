# J COLLECTION AI CONCIERGE — M3.5.1 FINAL GROUND TRUTH HARDENING AUDIT REPORT
**BÁO CÁO NGHIỆM THU CHỐT CHẶN DỮ LIỆU CHUẨN (GROUND TRUTH HARDENING & FINAL MICRO-FIX)**

- **Dự án**: J Collection AI Concierge
- **Repository**: `C:\Chatbot`
- **Phiên bản hoàn thành**: Milestone 3.5.1 (Ground Truth Hardening, Invariant Alignment & Parking Micro-Fix)
- **Ngày thực hiện**: 22/11/2026
- **Trạng thái kiểm thử**: **32/32 test files PASS (100%) · 294/294 test cases PASS (100%)**
- **Trạng thái TypeScript**: **0 Type Errors (`npx.cmd tsc --noEmit` PASS)**
- **Canonical Dataset Integrity**: **SHA-256 Khớp 100% (`22df0ec50596e26fc7f7b2b889bfff0a626c15e9c3ebd773684658fed38e44b6`)**

---

## 1. BẢNG ĐỐI CHIẾU NGUYÊN NHÂN GỐC RỄ & VỊ TRÍ SỬA ĐỔI

Trong đợt nghiệm thu transcript M3.5 và rà soát M3.5.1 Final Micro-fix, các phát biểu của hệ thống đã được đối chiếu nghiêm ngặt với dữ liệu gốc `data/j_collection_dataset.json`:

| Vấn đề phát hiện | Nguyên nhân gốc rễ | Giải pháp kỹ thuật M3.5.1 & Micro-Fix | Vị trí mã nguồn đã sửa |
| :--- | :--- | :--- | :--- |
| **1. Sai địa chỉ Jacayl Hà Đông**<br>Chatbot từng trả lời: `Biệt thự TT3-C19 KĐT Văn Quán, Hà Đông, Hà Nội` | Thông tin địa chỉ bị hardcode trong `AdvisoryComposer.getFacilityInfo()` và template `KnowledgeBase` từ giai đoạn thử nghiệm cũ. | Cập nhật `AdvisoryComposer.getFacilityInfo()` để lấy `co_so.dia_chi` từ `NormalizedDataset`. Chuẩn hóa fallback đúng nguyên văn: `Ngã ba Phúc La Phùng Hưng`. Chặn hoàn toàn các chuỗi địa chỉ lạ qua Claim Validator. | [advisory-composer.ts](file:///C:/Chatbot/src/conversation/advisory-composer.ts#L31-L67)<br>[knowledge-base.ts](file:///C:/Chatbot/src/knowledge/knowledge-base.ts#L38-L58)<br>[orchestrator.ts](file:///C:/Chatbot/src/conversation/orchestrator.ts#L65-L75)<br>[claim-validator.ts](file:///C:/Chatbot/src/conversation/grounding/claim-validator.ts#L267-L280) |
| **2. Bịa đặt / suy diễn thông tin bãi đỗ xe**<br>Xuất hiện khẳng định: *"Bãi đỗ ô tô rộng rãi ngay trước cửa"*, *"cách 50m"*, *"phí gửi xe"* | Dataset gốc chỉ ghi ngắn gọn: `quy_dinh.do_xe = "Có chỗ đỗ xe."`. Phần `gioi_thieu` có câu PR cũ và câu trả lời cũ tự diễn giải thêm vị trí, loại xe và phí bãi. | **Micro-Fix**: Xóa hoặc vô hiệu hóa toàn bộ khẳng định "Bãi đỗ ô tô rộng rãi ngay trước cửa". Khóa cứng câu trả lời cho mọi thắc mắc đỗ xe thành duy nhất: **"Dạ bên em có chỗ đỗ xe ạ."**. Không suy luận loại xe (ô tô/xe máy), khoảng cách (50m/100m), vị trí hay mức phí. Validator chặn mọi phát ngôn suy diễn này. | [knowledge-base.ts](file:///C:/Chatbot/src/knowledge/knowledge-base.ts#L85-L103)<br>[knowledge-base.ts](file:///C:/Chatbot/src/knowledge/knowledge-base.ts#L344-L355)<br>[policy-qa-engine.ts](file:///C:/Chatbot/src/knowledge/policy-qa-engine.ts#L294-L308)<br>[claim-validator.ts](file:///C:/Chatbot/src/conversation/grounding/claim-validator.ts#L281-L293) |
| **3. Thiếu hụt Knowledge Topics**<br>Topic 3 & 4 của M3 bị thiếu khi bổ sung các topic phòng 601 và 401 | Trong đợt M3.5, mảng `KNOWLEDGE_TOPICS` bị ghi đè thay vì nối thêm. | Khôi phục đầy đủ `WEEKDAY_VS_WEEKEND` (Topic 3) và `DAYTIME_18H_BOUNDARY` (Topic 4). Mở rộng mảng lên **23 topics**, bảo toàn 100% chính sách nghiệp vụ M3 và M3.5. | [knowledge-base.ts](file:///C:/Chatbot/src/knowledge/knowledge-base.ts#L105-L135)<br>[policy-qa-engine.ts](file:///C:/Chatbot/src/knowledge/policy-qa-engine.ts#L155-L185)<br>[policy-qa.test.ts](file:///C:/Chatbot/tests/policy-qa.test.ts#L85-L115) |
| **4. Tự suy diễn tầng phòng**<br>Nhóm phòng 401-405 Hà Đông bị gọi là "các phòng tầng 4" | Trong `data/j_collection_dataset.json`, các phòng 40x tại Hà Đông có trường `tang_theo_website: null`. Model cũ tự lấy ký tự đầu của số phòng "4" để suy luận tầng 4. | Khi `tang_theo_website === null`, trường `tang` có trạng thái `status: 'UNKNOWN'`. Trong câu trả lời phòng 401 không kinh doanh, sửa câu đề xuất từ *"các phòng tầng 4 khác"* thành *"các phòng khác như 402 — Whisky, 403 — Led Neon..."*. Validator từ chối khẳng định "phòng tầng 4 tại Hà Đông". | [room-business-registry.ts](file:///C:/Chatbot/src/domain/room-business-registry.ts#L45-L65)<br>[claim-validator.ts](file:///C:/Chatbot/src/conversation/grounding/claim-validator.ts#L294-L302)<br>[ground-truth-hardening.test.ts](file:///C:/Chatbot/tests/ground-truth-hardening.test.ts#L93-L108) |
| **5. Rà soát trạng thái FAQ cũ**<br>Máy chiếu, bồn tắm đôi, người thứ ba, voucher | Nguy cơ chatbot tự sáng tạo thêm chính sách hoặc đảo ngược trạng thái xác thực. | Duy trì chính xác phân loại theo nguyên tắc Ground Truth: Máy chiếu = `UNCONFIRMED`, Bồn tắm đôi = `UNCONFIRMED`, Người thứ ba = `UNKNOWN`, Voucher = `UNKNOWN`. Tuyệt đối không tự thêm chính sách. | [knowledge-base.ts](file:///C:/Chatbot/src/knowledge/knowledge-base.ts#L290-L380)<br>[policy-qa-engine.ts](file:///C:/Chatbot/src/knowledge/policy-qa-engine.ts#L140-L175)<br>[ground-truth-hardening.test.ts](file:///C:/Chatbot/tests/ground-truth-hardening.test.ts#L198-L230) |

---

## 2. DANH SÁCH TỆP NGUỒN ĐÃ CHỈNH SỬA & BỔ SUNG

Các tệp được cập nhật đồng bộ trong Milestone 3.5.1 Final Micro-Fix:

1. **[src/knowledge/knowledge-base.ts](file:///C:/Chatbot/src/knowledge/knowledge-base.ts)**:
   - Mục `FAC_${cs.ma}_PARKING`: Xóa khẳng định *"Bãi đỗ ô tô rộng rãi ngay trước cửa"*. Chuẩn hóa `guidance_for_assistant`: *"Dạ bên em có chỗ đỗ xe ạ. Không suy luận loại xe, khoảng cách, vị trí hoặc mức phí khi chưa có bằng chứng chi tiết hơn."*
   - Mục `REGISTRY_PARKING_FEE_UNCONFIRMED`: Đặt `original_value: 'Có chỗ đỗ xe.'`, chuẩn hóa hướng dẫn trả lời ngắn gọn, trung thực theo dataset.
   - Duy trì toàn vẹn 23 Topics, bảo vệ trạng thái của các FAQ cũ: `may_chieu` (`UNCONFIRMED`), `bon_tam_doi` (`UNCONFIRMED`), `phu_thu_nguoi_thu_ba` (`UNKNOWN`), `khuyen_mai_voucher` (`UNKNOWN`).
2. **[src/knowledge/policy-qa-engine.ts](file:///C:/Chatbot/src/knowledge/policy-qa-engine.ts)**:
   - Module xử lý câu hỏi đỗ xe: Trả về duy nhất **`Dạ bên em có chỗ đỗ xe ạ.`**, triệt tiêu mọi phân nhánh cơ sở suy diễn thêm vị trí, loại xe hay phí gửi.
3. **[src/conversation/grounding/claim-validator.ts](file:///C:/Chatbot/src/conversation/grounding/claim-validator.ts)**:
   - Cập nhật quy tắc `REJECTED_UNSOURCED_PARKING_DISTANCE`: Chặn mọi khẳng định về bãi đỗ xe chứa thông tin khoảng cách (50m, 100m), vị trí chưa xác minh ("rộng rãi ngay trước cửa", "ngay trước cửa"), hoặc mức phí/miễn phí ("miễn phí", "có phí", "mất phí").
4. **[src/conversation/advisory-composer.ts](file:///C:/Chatbot/src/conversation/advisory-composer.ts)**:
   - Phương thức `getFacilityInfo(facility: CoSoMa)` trích xuất chuẩn xác địa chỉ từ dataset: `Ngã ba Phúc La Phùng Hưng`, `283 Trần Khát Chân`, `64 Triệu Việt Vương`.
5. **[tests/policy-qa.test.ts](file:///C:/Chatbot/tests/policy-qa.test.ts)**:
   - Kiểm thử Topic 14 xác nhận câu trả lời đỗ xe là `Dạ bên em có chỗ đỗ xe ạ.`, không chứa các từ khóa suy diễn.
6. **[tests/ground-truth-hardening.test.ts](file:///C:/Chatbot/tests/ground-truth-hardening.test.ts)**:
   - Bổ sung Requirement 11 (Kiểm thử câu trả lời đỗ xe tại cả 3 cơ sở và kiểm tra bộ lọc ClaimValidator).
   - Bổ sung Requirement 12 (Kiểm thử 4 FAQ cũ: máy chiếu, bồn tắm đôi, người thứ ba, voucher với đúng trạng thái UNCONFIRMED / UNKNOWN).

---

## 3. BẢNG SO SÁNH KNOWLEDGE TOPICS TRƯỚC VÀ SAU M3.5.1

Hệ thống duy trì đầy đủ **23 topics** bảo vệ toàn diện tri thức nghiệp vụ:

| STT | Mã Topic | Tên Chính Sách | Trạng thái trước M3.5.1 | Trạng thái sau M3.5.1 & Micro-Fix |
| :---: | :--- | :--- | :---: | :---: |
| 1 | `POLICY_STANDARD_CHECKIN_CHECKOUT` | Giờ nhận & trả phòng chuẩn | Có mặt | Duy trì |
| 2 | `POLICY_OVERNIGHT_HOURS` | Khung giờ lưu trú qua đêm | Có mặt | Duy trì |
| **3** | `POLICY_WEEKDAY_VS_WEEKEND` | **Nguyên tắc ngày trong tuần & cuối tuần** | **Bị thiếu** | **ĐÃ PHỤC HỒI CHUẨN XÁC** |
| **4** | `POLICY_DAYTIME_18H_BOUNDARY` | **Ranh giới tính giá giờ ngày & sau 18h** | **Bị thiếu** | **ĐÃ PHỤC HỒI CHUẨN XÁC** |
| 5 | `POLICY_EARLY_MORNING_CHECKIN` | Nhận phòng sáng sớm (trước 08:00) | Có mặt | Duy trì |
| 6 | `POLICY_EXTRA_HOURS_SURCHARGE` | Phụ thu giờ phát sinh & ân hạn 10 phút | Có mặt | Duy trì |
| 7 | `POLICY_NO_HOLIDAY_SURCHARGE` | Nghiêm cấm phụ thu ngày lễ | Có mặt | Duy trì |
| 8 | `POLICY_MINIMUM_STAY_HOURLY` | Thời gian thuê tối thiểu 2 giờ | Có mặt | Duy trì |
| 9 | `POLICY_OVERNIGHT_EARLY_CHECKIN` | Khung ân hạn qua đêm từ 21:40 | Có mặt | Duy trì |
| 10 | `POLICY_DAY_NIGHT_PACKAGE_BOUNDARY` | Gói Ngày Đêm (14h hôm trước - 12h hôm sau) | Có mặt | Duy trì |
| 11 | `POLICY_PETS_DISCLAIMER` | Chính sách thú cưng (Route to Staff) | Có mặt | Duy trì |
| 12 | `POLICY_SMOKING_DISCLAIMER` | Chính sách hút thuốc (Route to Staff) | Có mặt | Duy trì |
| 13 | `POLICY_KITCHEN_DISCLAIMER` | Chính sách bếp nấu (Disclaim rõ ràng) | Có mặt | Duy trì |
| **14** | `POLICY_PARKING_TERMS` | **Chính sách đỗ xe** | **Lẫn thông tin 50m & rộng rãi** | **ĐÃ LÀM SẠCH: "Dạ bên em có chỗ đỗ xe ạ."** |
| 15 | `POLICY_ID_REQUIREMENT` | Giấy tờ tùy thân | Có mặt | Duy trì |
| 16 | `POLICY_CANCELLATION_REFUND` | Hủy phòng (Chuyển nhân viên) | Có mặt | Duy trì |
| 17 | `FAC_j-village_OVERVIEW` | Giới thiệu cơ sở J Village (64 Triệu Việt Vương) | Có mặt | Duy trì |
| 18 | `FAC_jacayl-tran-khat-chan_OVERVIEW` | Giới thiệu Jacayl Trần Khát Chân (283 Trần Khát Chân) | Có mặt | Duy trì |
| 19 | `FAC_jacayl-ha-dong_OVERVIEW` | Giới thiệu Jacayl Hà Đông | Lẫn TT3-C19 | **ĐÃ SỬA: Ngã ba Phúc La Phùng Hưng** |
| 20 | `POLICY_PRICE_CALCULATION_METHOD` | Phương pháp tính giá theo giờ check-in | Có mặt | Duy trì |
| 21 | `POLICY_STAY_PACKAGE_ELIGIBILITY` | Điều kiện áp dụng các gói lưu trú | Có mặt | Duy trì |
| 22 | `CANONICAL_ROOM_IDENTITY_601` | Phòng 601 Hà Đông là "50 — Sắc Thái" | Mới bổ sung | Duy trì & Bảo vệ |
| 23 | `NON_COMMERCIAL_ROOM_401_HA_DONG` | Phòng 401 Hà Đông là NOT_FOR_SALE | Mới bổ sung | **ĐÃ XÓA CỤM TẦNG 4** |

---

## 4. KẾT QUẢ KIỂM THỬ GOLDEN TESTS (EXPECTED VS ACTUAL)

Bộ kiểm thử tích hợp chuyên biệt `tests/ground-truth-hardening.test.ts` đã hoàn thành toàn bộ 12 ca kiểm thử:

```
✓ Requirement 1: strictly uses canonical dataset address for all three facilities (1ms)
✓ Requirement 2: unapproved addresses (TT3-C19, Văn Quán) never appear in responses (21ms)
✓ Requirement 3: Knowledge Base retains all original topics including restored 3 & 4 (0ms)
✓ Requirement 4: Parking policy strictly reflects dataset "Có chỗ đỗ xe" without invented distance (0ms)
✓ Requirement 5: Does not infer floor from room code when tang_theo_website is null (5ms)
✓ Requirement 6: Room 601 is strictly "50 — Sắc Thái" (1ms)
✓ Requirement 7: Room 401 Ha Dong is NOT_FOR_SALE, while other 401s are commercial (0ms)
✓ Requirement 8: Ha Dong confirmed bathtub rooms are strictly 101, 601, 602 (1ms)
✓ Requirement 9: Business Policy V1.4.3 non-regression (weekend lock-in, 2h min, no holiday hike) (2ms)
✓ Requirement 10: Provider error or fallback does not produce ungrounded information (2ms)
✓ Requirement 11: Micro-fix - Parking answer is strictly "Dạ bên em có chỗ đỗ xe ạ." across all facilities without unverified inferences (0ms)
✓ Requirement 12: Micro-fix - Legacy FAQs (projector, double bathtub, third person, voucher) maintain strict status (1ms)
```

### Đối chiếu chi tiết Expected vs Actual:

| Hạng mục kiểm thử | Giá trị Kỳ vọng (Expected) | Kết quả Thực tế (Actual) | Đánh giá |
| :--- | :--- | :--- | :---: |
| **Câu trả lời đỗ xe** | Đúng từng chữ: `"Dạ bên em có chỗ đỗ xe ạ."`<br>Không có từ ngữ suy diễn | `"Dạ bên em có chỗ đỗ xe ạ."` | **PASS** |
| **Từ chối vị trí đỗ xe chưa xác minh** | Chặn các khẳng định `"bãi đỗ ô tô rộng rãi ngay trước cửa"` | ClaimValidator gắn cờ `REJECTED_UNSOURCED_PARKING_DISTANCE` | **PASS** |
| **Từ chối phí gửi xe chưa xác minh** | Chặn các khẳng định `"miễn phí gửi xe"` hoặc `"có phí 50k"` | ClaimValidator gắn cờ `REJECTED_UNSOURCED_PARKING_DISTANCE` | **PASS** |
| **FAQ Máy chiếu** | Trạng thái: `UNCONFIRMED`, `requires_staff_verification: true` | `UNCONFIRMED`, yêu cầu liên hệ lễ tân | **PASS** |
| **FAQ Bồn tắm đôi** | Trạng thái: `UNCONFIRMED`, `requires_staff_verification: true` | `UNCONFIRMED`, ghi nhận 5 phòng bồn tắm nằm | **PASS** |
| **FAQ Người thứ ba** | Trạng thái: `UNKNOWN`, `requires_staff_verification: true` | `UNKNOWN`, hướng dẫn khách liên hệ lễ tân | **PASS** |
| **FAQ Voucher** | Trạng thái: `UNKNOWN`, không cấp voucher tự động | `UNKNOWN`, giải thích theo biểu phí niêm yết | **PASS** |
| **Địa chỉ Jacayl Hà Đông** | Chứa `Ngã ba Phúc La Phùng Hưng`<br>Tuyệt đối không chứa `TT3-C19` hay `Văn Quán` | `"Dạ cơ sở Jacayl Hà Đông ở tại: Ngã ba Phúc La Phùng Hưng..."` | **PASS** |
| **Tầng phòng khi data null** | Phòng 402 Hà Đông: `tang.status === 'UNKNOWN'`, `tang.value === undefined` | `room402?.tang.status === 'UNKNOWN'` | **PASS** |
| **Tên phòng 601 Hà Đông** | Giữ nguyên `50 — Sắc Thái`, không dùng `Tổng Thống` hay `50 Shades` | `"50 — Sắc Thái"`, không chứa "Tổng Thống", không chứa "50 Shades" | **PASS** |
| **Trạng thái phòng 401** | Hà Đông: `NOT_FOR_SALE`<br>TKC 401-blush & J Village 401-mosaic: Thương mại bình thường | Hà Đông: `true`<br>TKC & J Village: `false` | **PASS** |

---

## 5. KẾT QUẢ KIỂM THỬ TOÀN DIỆN HỆ THỐNG

### 5.1. Vitest Test Suites
Toàn bộ **32 file test** với **294 ca kiểm thử** đều vượt qua tuyệt đối không có bất kỳ cảnh báo hoặc lỗi nào:
- `tests/invariants.test.ts` (7 tests) — PASS
- `tests/pricing-policy-loader.test.ts` (8 tests) — PASS
- `tests/pricing-resolver.test.ts` (34 tests) — PASS
- `tests/gemini-provider.test.ts` (7 tests) — PASS
- `tests/free-llm-gateway.test.ts` (9 tests) — PASS
- `tests/business-policy-v1_4_3.test.ts` (20 tests) — PASS
- `tests/adversarial-dialogues.test.ts` (4 tests) — PASS
- `tests/stay-package-eligibility.test.ts` (10 tests) — PASS
- `tests/overnight-advisory-multiturn.test.ts` (3 tests) — PASS
- `tests/ground-truth-hardening.test.ts` (12 tests) — PASS
- `tests/golden-dialogues.test.ts` (10 tests) — PASS
- `tests/canonical-room-identity.test.ts` (11 tests) — PASS
- `tests/golden-multi-turn-extended.test.ts` (2 tests) — PASS
- `tests/m3_5-live-dialogue-evaluation.test.ts` (15 tests) — PASS
- `tests/conversation-evaluation.test.ts` (16 tests) — PASS
- `tests/room-search.test.ts` (9 tests) — PASS
- `tests/nlu-engine.test.ts` (10 tests) — PASS
- `tests/constraint-retraction.test.ts` (4 tests) — PASS
- `tests/transformer.test.ts` (7 tests) — PASS
- `tests/reference-resolver.test.ts` (4 tests) — PASS
- `tests/groq-provider.test.ts` (7 tests) — PASS
- `tests/temporal-resolver.test.ts` (5 tests) — PASS
- `tests/pii-redaction.test.ts` (7 tests) — PASS
- `tests/policy-consistency.test.ts` (8 tests) — PASS
- `tests/memory-manager.test.ts` (5 tests) — PASS
- `tests/policy-qa.test.ts` (23 tests) — PASS
- `tests/category-mapper.test.ts` (5 tests) — PASS
- `tests/schema-validation.test.ts` (5 tests) — PASS
- `tests/claim-validator.test.ts` (10 tests) — PASS
- `tests/real-llm-gateway.test.ts` (4 tests) — PASS
- `tests/free-api-smoke.test.ts` (2 tests) — PASS
- `tests/dataset-audit.test.ts` (11 tests) — PASS

**Tổng cộng**: **32 passed (32 files) · 294 passed (294 tests)** trong 2.93s.

### 5.2. TypeScript Compilation Check
```powershell
npx.cmd tsc --noEmit
# Exit code: 0 (0 error)
```

### 5.3. Build Execution Check
```powershell
npm.cmd run build
# > j-collection-ai-concierge@1.0.0 build
# > tsc
# Output: Thư mục dist/ được biên dịch hoàn chỉnh, không có lỗi runtime.
```

---

## 6. XÁC NHẬN TÍNH TOÀN VẸN CỦA CANONICAL DATASET (SHA-256)

Kiểm tra mã băm SHA-256 tệp gốc `data/j_collection_dataset.json` qua công cụ hệ thống `certutil`:
```
SHA256 hash of data/j_collection_dataset.json:
22df0ec50596e26fc7f7b2b889bfff0a626c15e9c3ebd773684658fed38e44b6
CertUtil: -hashfile command completed successfully.
```
**Khẳng định**: Tệp dữ liệu gốc hoàn toàn nguyên vẹn, không bị chỉnh sửa bất kỳ ký tự nào, đúng 100% chỉ thị của Chủ dự án.

---

## 7. TÌNH TRẠNG TÍCH HỢP FREE API (GROQ & GEMINI)

Hệ thống Free LLM Gateway tuân thủ nghiêm ngặt chỉ thị **KHÔNG PHÁT SINH CHI PHÍ (FREE ONLY)**:

1. **Khóa an toàn chi phí**: Cấu hình `FREE_ONLY_MODE = true` được kích hoạt vĩnh viễn ở cấp framework. Mọi nỗ lực gọi model trả phí đều bị chặn ngay tại adapter layer.
2. **Mô hình miễn phí được cấu hình**:
   - **Groq Free**: `openai/gpt-oss-20b` (hoặc `llama-3.3-70b-versatile`)
   - **Google Gemini Free**: `gemini-3.5-flash-lite`
3. **Trạng thái kiểm thử trực tiếp hiện tại**:
   - Ghi nhận trạng thái **`IMPLEMENTED_NOT_LIVE_VERIFIED`** khi chưa cấu hình key và tự động fallback về MockLLMAdapter với độ trễ < 5ms.

---

## 8. KẾT LUẬN NGHIỆM THU & TÍNH SẴN SÀNG CHO MILESTONE 4

### Kết luận nghiệm thu:
1. **Dữ liệu chuẩn 100%**: Loại bỏ hoàn toàn khẳng định chưa có nguồn *"Bãi đỗ ô tô rộng rãi ngay trước cửa"*. Mọi thắc mắc về đỗ xe chỉ trả lời duy nhất: `"Dạ bên em có chỗ đỗ xe ạ."`, không suy luận loại xe, vị trí hay phí.
2. **FAQ cũ nguyên vẹn**: Máy chiếu (`UNCONFIRMED`), Bồn tắm đôi (`UNCONFIRMED`), Người thứ ba (`UNKNOWN`), Voucher (`UNKNOWN`) được giữ đúng chuẩn, không tự tạo thêm chính sách.
3. **Chất lượng kỹ thuật**: 294 tests tự động pass 100%, 0 lỗi TypeScript, dataset hash bất biến.
4. **Sẵn sàng cho Milestone 4**: Đã sẵn sàng bước vào Milestone 4 khi có chỉ thị từ Chủ dự án.
