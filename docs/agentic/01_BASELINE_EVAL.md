# J COLLECTION — PHASE 0 & BASELINE EVALUATION REPORT
**Tài liệu:** `docs/agentic/01_BASELINE_EVAL.md`  
**Phiên bản:** M4.3 Baseline Audit  
**Ngày kiểm toán:** 23/11/2026  
**Trạng thái kiểm tra:** VERIFIED  

---

## I. TỔNG QUAN KẾT QUẢ BASELINE M4.3

Kiểm tra trực tiếp bộ regression test suite của Milestone 4.3 trong môi trường thực tế:
- **Tổng số test files được quét:** 42 files.
- **Tổng số tests:** 422 tests (378 PASSED, 18 FAILED, 26 SKIPPED).
- **Trạng thái E2E Browser:** 6 flows Playwright Chromium chạy độc lập trên `tests/e2e/dashboard-browser-e2e.test.ts`.

> **Ghi chú quan trọng:** Tuân thủ chỉ thị của Chủ dự án: **Giữ nguyên các trường hợp FAIL, báo cáo trung thực, không sửa canonical dataset hay Business Policy chỉ để ép test pass.**

---

## II. PHÂN TÍCH 18 TRƯỜNG HỢP TEST FAIL TRONG LEGACY M4.3

Qua kiểm tra chi tiết runtime output tại `output.txt`, 18 test fail tập trung vào 4 nhóm nguyên nhân gốc rễ phản ánh đúng căn bệnh của hệ thống rule/template-centric:

### 1. Bẫy ép câu từ (Brittle Template String Assertions)
- **Triệu chứng:** `tests/overnight-advisory-multiturn.test.ts:111`
  - *Test mong đợi:* chuỗi con `'tối thiểu 2 tiếng'`
  - *Template thực tế trả về:* `'1. **Nghỉ theo giờ (tối thiểu 2 giờ)**'`
  - *Bản chất:* Nội dung nghiệp vụ đúng 100% (bên em áp dụng tối thiểu 2 giờ), nhưng test fail chỉ vì từ "tiếng" khác từ "giờ".
- **Triệu chứng:** `tests/overnight-advisory-multiturn.test.ts:45`
  - *Test mong đợi:* chuỗi con `'20 phút'` trong kịch bản ân hạn nhận phòng sớm ban đêm.
  - *Template thực tế trả về:* Bảng giá qua đêm tiêu chuẩn nhưng thiếu đoạn text giải thích ân hạn 20 phút do nhánh router rẽ sang `QUOTE_CATEGORY_PRICE`.

### 2. Khẳng định phủ định không có căn cứ (Ungrounded Negative Assertion)
- **Triệu chứng:** `tests/blind-eval-representative.test.ts` (Case 2: Jacuzzi vs soaking tub)
  - *Hệ thống cũ trả về:* `"toàn bộ các phòng có bồn tắm của bên em là bồn tắm nằm ngâm thư giãn, khách sạn không có bồn sục Jacuzzi"`
  - *Bản chất:* Dataset gốc không nhắc đến Jacuzzi, nghĩa là giá trị là `UNKNOWN`. Template cũ tự biến `UNKNOWN` thành khẳng định phủ định `FALSE` ("không có bồn sục Jacuzzi").

### 3. Cứng nhắc trong định tuyến nhiều bước (Multi-turn Slot Contradiction)
- **Triệu chứng:** `tests/overnight-advisory-multiturn.test.ts:88` (Scenario 2: Holiday pricing -> Saturday 09:00 Concept room quote)
  - Khi khách hỏi chính sách ngày lễ ở lượt 1, sau đó ở lượt 2 hỏi giá phòng Concept sáng thứ 7, bộ nhớ M4.3 bị xung đột giữa `POLICY_MATCH` và `SEARCH_ROOM`, khiến danh sách `verified_candidates` bị rỗng (0 candidates).

### 4. Mâu thuẫn logic phụ thu 601 vs 101 Hà Đông
- **Triệu chứng:** `tests/m4_3-autonomous-lab.test.ts` (Core 3: Saturday 17h for 4 hours room 601 Ha Dong)
  - Khách hỏi phòng 601 nghỉ 4 tiếng chiều thứ 7:
    - Giá đúng chuẩn nghiệp vụ: 2h đầu 449k + 2h phát sinh x 200k = **849.000đ**.
    - Nhưng ở một số kịch bản tìm kiếm chung, hệ thống lấy nhầm đơn giá phát sinh 100k của phòng 101 áp sang cho 601, ra mức sai 649.000đ hoặc ngược lại.

---

## III. BẢNG ĐỐI CHIẾU SỰ THẬT DỮ LIỆU (GROUND TRUTH AUDIT)

| Thực thể | Nguồn kiểm chứng (File & Line) | Giá trị thực tế đã xác minh | Nhận định |
|---|---|---|---|
| **Phòng 601 Hà Đông** | `data/jacayl-ha-dong.json:1421` | Tiện nghi: "Bồn tắm lớn", "Ghế tình yêu" | Chỉ có nhãn "Bồn tắm lớn". Không có kích thước 1,7–1,8m. |
| **Jacuzzi toàn chuỗi** | `data/j_collection_dataset.json` | 0 phòng có từ khóa Jacuzzi/bồn sục | Trạng thái đúng: `UNKNOWN` (chưa có nguồn). Không được gán `FALSE`. |
| **Phòng 202 Hà Đông (Ngày đêm)** | `data/jacayl-ha-dong.json:149`, `data/j_collection_dataset.json:148` | `ngay_dem: 650000` (650.000đ) | Báo cáo M4.2.1 ghi đúng 650k. Báo cáo M4.3 ghi nhầm 690k do lỗi typo trong markdown. |
| **Phòng có bồn tắm** | `src/domain/transformer.ts:61-69` | 5 phòng toàn chuỗi: 3 Hà Đông (101, 601, 602), 1 TKC (1001), 1 J Village (Crimson Suite) | Đã xác minh 100% qua code và dataset. |
| **Giá 4 tiếng chiều T7 phòng 601** | `PreBookingQuoteEngine` runtime | 449.000đ + (2 x 200.000đ) = 849.000đ | Vượt ngân sách 800.000đ. |
| **Giá 4 tiếng chiều T7 phòng 101** | `PreBookingQuoteEngine` runtime | 449.000đ + (2 x 100.000đ) = 649.000đ | Nằm trong ngân sách 800.000đ, thỏa mãn bồn tắm + lãng mạn. |

---

## IV. BÀI HỌC VÀ KẾT LUẬN ĐỊNH HƯỚNG SANG AGENTIC AI

1. **Sự bế tắc của việc "Vá luật bằng Regex & Template":**
   Càng viết thêm regex và câu mẫu, số lượng ca biên (edge cases) càng tăng theo hàm số mũ. Khi khách hỏi một câu kết hợp: *"ngân sách 800k, nếu phòng đầu tiên vượt thì tìm phương án gần nhất"*, hệ thống rule-centric hoàn toàn bất lực vì luồng xử lý bị gắn chặt vào 1 intent duy nhất.

2. **Yêu cầu tất yếu của Agentic System:**
   - LLM phải được quyền **suy luận trên mục tiêu (Reasoning-first)**.
   - LLM phải được **chọn công cụ (Tool-driven)** để tự tra cứu giá phòng 601 (849k) và phòng 101 (649k).
   - LLM phải **quan sát kết quả (Observation)** để thấy 601 vượt ngân sách 800k và chủ động đề xuất 101 làm giải pháp thay thế tối ưu.
   - Backend nắm giữ **kiểm soát nghiệp vụ (Business-controlled)**: giá tiền, dữ kiện phòng, phạm vi tenant là bất biến, LLM không thể bịa đặt.
