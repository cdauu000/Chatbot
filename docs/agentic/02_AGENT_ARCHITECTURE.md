# J COLLECTION — AGENTIC AI ARCHITECTURE SPECIFICATION
**Phiên bản:** 1.0 (Agentic Vertical Slice)  
**Ngày ban hành:** 23/11/2026  
**Định hướng:** Reasoning-first · Tool-driven · Business-controlled  
**Scope:** Tầng tư duy hội thoại cơ sở Hà Đông (`jacayl-ha-dong`)  

---

## I. MỤC TIÊU KIẾN TRÚC & PHẠM VI RANH GIỚI (TRUST BOUNDARIES)

Hệ thống chuyển đổi từ luồng kịch bản thác nước (Rule/Template-centric Waterfall) sang **Agentic AI System**:
1. **LLM toàn quyền quyết định:** Cách hiểu ý định khách hàng, lập kế hoạch suy luận, lựa chọn công cụ phù hợp và diễn giải câu trả lời bằng tiếng Việt tự nhiên như lễ tân khách sạn.
2. **Backend toàn quyền kiểm soát (Business-controlled):**
   - **Quyền hạn Tool:** Chỉ cho phép thực thi danh mục 5 tool đọc dữ liệu đã định nghĩa.
   - **Property Scope (Tenant Isolation):** Ép cứng `property_id` tin cậy từ server/kênh kết nối (`jacayl-ha-dong`). Agent không thể vượt quyền xem hay sửa dữ liệu cơ sở khác.
   - **Authoritative Data & Pricing:** Đơn giá, phụ thu, chính sách ân hạn bắt buộc tính từ `PreBookingQuoteEngine` và `Business Policy V1.4.3`. Agent không được tự nhân chia cộng trừ giá trong prompt.
   - **Response Assertion Guard:** `ClaimLevelValidator` kiểm duyệt đầu ra của Agent trước khi gửi cho khách, chặn tuyệt đối việc tự ý cam kết giữ phòng, bịa đặt kích thước bồn tắm hay phụ thu trái quy định.
   - **Không cấp quyền nguy hiểm:** Tuyệt đối không cho LLM truy cập SQL trực tiếp, gọi API nội bộ tùy ý hoặc thực hiện giao dịch ghi/xóa dữ liệu.

---

## II. SƠ ĐỒ VÒNG LẶP SUY LUẬN (BOUNDED REASONING LOOP)

```text
               +---------------------------------------+
               |        Inbound Customer Message        |
               +---------------------------------------+
                                   |
                                   v
             [Phase 1: UNDERSTAND (Goal Understanding)]
             - Giải mã tiếng Việt, teencode, ngữ cảnh
             - Tách Hard Constraints vs Soft Preferences
             - Kiểm tra tính mơ hồ (Ambiguity Check)
                                   |
                                   v
               [Phase 2: DECIDE (Action & Planning)]
               - Chọn: Trả lời ngay (FAST)
                 hay Cần gọi công cụ (STANDARD / DEEP)
                                   |
                +------------------+------------------+
                |                                     |
         (Need Tools)                           (Direct Reply)
                |                                     |
                v                                     |
      [Phase 3: ACT (Tool Execution)]                 |
      - Backend validate Zod schema                   |
      - Ép server-side property_id                    |
      - Thực thi tool đọc dữ liệu                     |
                |                                     |
                v                                     |
     [Phase 4: OBSERVE (Observation)]                 |
     - Đọc dữ liệu trả về từ tools                    |
     - Phát hiện: Rỗng / Vượt ngân sách / Mâu thuẫn   |
                |                                     |
                v                                     |
      [Phase 5: REVISE (Adaptive Replanning)]         |
      - Sửa kế hoạch nếu phòng đầu tiên vượt tiền     |
      - Thử phương án gần nhất (Fallback match)       |
      - Bounded: tối đa 3 vòng lặp                    |
                |                                     |
                +------------------+------------------+
                                   |
                                   v
             [Phase 6: RESPOND (Grounded Composition)]
             - Trả lời tự nhiên, lịch sự, đúng trọng tâm
             - Minh bạch điều kiện thực tế
             - Không khẳng định phòng trống khi chưa check PMS
                                   |
                                   v
            [Phase 7: BUSINESS GUARD & CLAIM VALIDATOR]
            - Kiểm tra cam kết ảo (Fake Booking / 24/7)
            - Kiểm tra đơn giá khớp Quote Result
            - Kiểm tra cấm phụ thu ngày lễ
                                   |
                                   v
               +---------------------------------------+
               |        Customer-Facing Response       |
               +---------------------------------------+
```

---

## III. BA TUYẾN XỬ LÝ THEO ĐỘ PHỨC TẠP (ADAPTIVE REASONING TIERS)

| Tuyến | Tình huống kích hoạt | Số bước lặp | Công cụ sử dụng | Ví dụ |
|---|---|:---:|---|---|
| **FAST** | Chào hỏi, cảm ơn, hỏi chỗ đỗ xe hoặc tiện nghi đơn lẻ khi đã rõ phòng | 1 bước (0–1 tool) | `get_policies` hoặc trả lời trực tiếp | *"Bên em có chỗ đỗ ô tô không ạ?"* -> Trả lời ngay có chỗ đỗ. |
| **STANDARD** | Tìm phòng theo 1–2 tiêu chí, hỏi giá 1 phòng cụ thể | 1–2 bước | `search_rooms`, `quote_price` | *"Phòng 202 ở Hà Đông giá ngày đêm bao nhiêu?"* -> Gọi `quote_price` -> báo 650.000đ. |
| **DEEP** | Yêu cầu phức hợp nhiều điều kiện, ràng buộc ngân sách kết hợp sở thích, có mệnh đề điều kiện ("nếu vượt tiền thì...") | 2–3 bước | `search_rooms` -> `quote_price` (cho nhiều phòng) -> Observation -> Revise | *"Anh muốn phòng lãng mạn ở Hà Đông có bồn tắm, nghỉ 4 tiếng chiều T7, ngân sách 800k. Nếu phòng đầu tiên vượt tiền thì tìm phương án gần nhất."* |

---

## IV. BẢO VỆ DỮ LIỆU & QUẢN TRỊ BỘ NHỚ (WORKING MEMORY & INVALIDATION)

1. **State Persistence:** Lưu trữ có cấu trúc qua `AgentState`, không lưu chuỗi suy nghĩ thầm kín (private chain-of-thought) vào database khách hàng.
2. **Context Invalidation:**
   - Khi khách thay đổi ngày giờ hoặc chuyển đổi cơ sở, toàn bộ các bảng giá báo giá trước đó (`last_quote_id`, `quote_results`) bị vô hiệu hóa (`invalidated`).
   - Khách đổi sở thích ("thôi không cần bồn tắm nữa"), ràng buộc `must_have_amenities` được cập nhật, kích hoạt tìm kiếm lại.
3. **Traceability:** Mọi turn đều xuất ra `DecisionTrace` ghi lại: model provider thực tế, lý do chọn tool, tham số đã qua xác thực backend, kết quả tool, quan sát và các claim đã được validator duyệt.
