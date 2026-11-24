# J COLLECTION AI CONCIERGE — M4.2
## CONVERSATION INTELLIGENCE & CUSTOMER EXPERIENCE FIX REPORT
### ROOT CAUSE ANALYSIS · INTENT-DRIVEN RESPONSE CONTRACT · WORKING MEMORY ISOLATION · SERVER PROPERTY BINDING · REAL IMAGE DELIVERY · SAFE CHAT UI RENDERING · 38/38 TEST SUITES PASS (367/367 TESTS)

---

## MỤC LỤC
1. [Tóm tắt kết quả xử lý](#1-tóm-tắt-kết-quả-xử-lý)
2. [Root Cause Analysis chi tiết cho 6 vấn đề](#2-root-cause-analysis-chi-tiết-cho-6-vấn-đề)
3. [Bảng đối chiếu Intent vs Response Contract](#3-bảng-đối-chiếu-intent-vs-response-contract)
4. [Cơ chế Working Memory & Context Control](#4-cơ-chế-working-memory--context-control)
5. [Cơ chế Server-Side Property Context Binding](#5-cơ-chế-server-side-property-context-binding)
6. [Giải pháp Real Image Delivery](#6-giải-pháp-real-image-delivery)
7. [Cải tiến Chat UI & Safe Markdown Renderer](#7-cải-tiến-chat-ui--safe-markdown-renderer)
8. [Báo cáo 20 Acceptance Test Scenarios](#8-báo-cáo-20-acceptance-test-scenarios)
9. [Kết quả Regression Testing toàn diện](#9-kết-quả-regression-testing-toàn-diện)
10. [Cam kết không vi phạm Business Policy & Canonical Dataset](#10-cam-kết-không-vi-phạm-business-policy--canonical-dataset)

---

## 1. TÓM TẮT KẾT QUẢ XỬ LÝ

Đợt cập nhật **M4.2 — Conversation Intelligence & Customer Experience Fix** giải quyết triệt để 6 vấn đề hội thoại thực tế được Chủ dự án phát hiện trực tiếp trên Staff Dashboard, chuyển đổi hệ thống từ cơ chế phản hồi gộp (monolithic greedy advisory) sang kiến trúc **Intent-Driven Response Contract**.

| Chỉ số | Baseline M4 | Kết quả M4.2 | Ghi chú |
| :--- | :--- | :--- | :--- |
| **Test Files (Suites)** | 37 files | **38 files** | Thêm suite `tests/m4_2-conversation-experience.test.ts` (20 scenarios) |
| **Test Cases** | 347 tests | **367 tests** | **367/367 PASS (100%)** |
| **Dataset Hash (SHA-256)** | `22df0ec5...` | `22df0ec5...` | **Giữ nguyên 100% không đổi** |
| **Business Policy** | V1.4.3 Active | **V1.4.3 Active** | Toàn bộ bất biến giá và quy tắc kinh doanh được bảo toàn |
| **Free LLM Providers** | Groq & Gemini Verified | **Groq & Gemini Live Verified** | 0 fallback khi online, fallback an toàn khi offline |
| **Response Contract** | 4 generic intents | **11 specialized intents** | Phân tách rõ ràng giữa tra cứu, báo giá, xem phòng, xem ảnh |
| **UI Safe Rendering** | Raw Markdown `**` | **Safe Markdown + Safe HTML** | Render đậm/nghiêng/link sạch sẽ, chống triệt để XSS |
| **Image Delivery** | Mock string `Số ảnh: 4` | **Real Cloudflare R2 URLs** | Hiển thị thumbnail ảnh thật kèm modal phóng to xem ảnh |

---

## 2. ROOT CAUSE ANALYSIS CHI TIẾT CHO 6 VẤN ĐỀ

### Vấn đề 1: Hỏi phòng trống kích hoạt tìm phòng, báo giá và gợi ý phòng cụ thể
- **Hiện tượng**: Khách chỉ hỏi cơ sở Hà Đông còn phòng đêm nay không ("Hà Đông còn phòng đêm nay ko"), bot lập tức tra cứu dataset và hiển thị: *"Dạ em gửi anh/chị thông tin phòng phù hợp nhất: 601 - 50 Sắc Thái..."* cùng giá nghỉ 700.000đ.
- **Root Cause**:
  1. Trong `src/conversation/nlu-engine.ts`, intent `CHECK_ROOM_AVAILABILITY` chưa tồn tại như một intent độc lập cấp 1; biểu thức regex nhận diện từ khóa "còn phòng" bị phân loại gộp vào `SEARCH_ROOM`.
  2. Trong `src/conversation/orchestrator.ts`, luồng `chosenAction` khi thấy `SEARCH_ROOM` tự động gọi `roomSearch.searchRooms()` và `advisoryComposer.composeRecommendations()`.
- **Giải pháp**:
  - Tách intent `CHECK_ROOM_AVAILABILITY` độc lập với action `ANSWER_AVAILABILITY_TRANSPARENT`.
  - Khẳng định minh bạch: Chatbot chưa kết nối trực tiếp hệ thống quản lý buồng phòng theo thời gian thực (PMS).
  - Không cam kết giữ phòng ảo, không tự chọn 1 phòng cụ thể, không báo giá khi chưa hỏi.
  - Giới thiệu 3 hạng phòng chính thức (Standard, Deluxe, Concept) để khách lựa chọn tìm hiểu tiếp, cung cấp hotline lễ tân khi cần hỗ trợ tức thì.

### Vấn đề 2: Khung chat đã gắn với cơ sở Hà Đông nhưng bot vẫn hỏi khách chọn cơ sở
- **Hiện tượng**: Khách nhắn trong giao diện hội thoại đã định tuyến cho Jacayl Hà Đông (`propertyId = jacayl-ha-dong`), nhưng bot vẫn trả lời: *"Dạ anh/chị muốn xem phòng ở cơ sở nào ạ? Bên em có Hà Đông, La Casta..."*
- **Root Cause**:
  1. Frontend gửi message đến `/api/conversations/:id/messages` có context conversation lưu `propertyId`, nhưng `takeover-coordinator.ts` khi gọi `orchestrator.processTurn` không truyền thuộc tính ràng buộc cơ sở vào bộ nhớ làm việc.
  2. `memory.active_facility` chỉ được cập nhật khi NLU trích xuất được tên cơ sở trong nội dung văn bản khách vừa gõ. Nếu khách gõ ngắn ("cho xem các hạng phòng"), NLU không thấy tên cơ sở nên coi là thiếu `facility` và kích hoạt câu hỏi phân luồng.
- **Giải pháp**:
  - Mở rộng `ProcessTurnOptions` trong orchestrator với trường `boundPropertyId?: CoSoMa`.
  - Trong `takeover-coordinator.ts`, nạp `boundPropertyId: conv.propertyId` vào mỗi lượt hội thoại.
  - Orchestrator lập tức gán `memory.active_facility = options.boundPropertyId` ngay trước khi suy luận, triệt tiêu câu hỏi lựa chọn cơ sở khi ngữ cảnh đã xác định.

### Vấn đề 3: Hỏi chỗ đỗ xe thì trả lời xe xong lại đính kèm gợi ý phòng và giá qua đêm
- **Hiện tượng**: Khách hỏi "bên em có chỗ đỗ ô tô ko", bot trả lời "Dạ bên em có chỗ đỗ xe ạ" rồi nói tiếp ngay: *"Em xin gợi ý phòng 50 — Sắc Thái giá qua đêm 700.000đ..."*
- **Root Cause**:
  1. Trong `orchestrator.ts`, điều kiện `shouldRunSearch` trước đây kiểm tra:
     `Boolean(memory.active_facility) && Boolean(memory.duration_hours || memory.must_have_amenities.length > 0)`
  2. Nếu ở lượt trước khách từng nhắc đến thời lượng hoặc tiện nghi, cờ này vẫn `true` ở lượt sau. Dù intent lượt sau là hỏi đỗ xe, orchestrator vẫn chạy ngầm search và nối đoạn text gợi ý phòng vào đuôi câu trả lời bãi đỗ xe.
- **Giải pháp**:
  - Bổ sung intent `ASK_PARKING` và action `ANSWER_PARKING_POLICY`.
  - Đặt điều kiện `shouldRunSearch = false` tuyệt đối cho các intent chính sách đơn thuần, hỏi đỗ xe, hỏi tình trạng phòng, hỏi danh mục phòng, hỏi ảnh.
  - Phản hồi đúng hợp đồng M3.5.1: *"Dạ bên em có chỗ đỗ xe ạ."* Không suy diễn loại xe, không thêm gợi ý phòng, không đính kèm giá không được hỏi.
  - Trong truy vấn phức hợp (vừa hỏi xe vừa tìm phòng), câu trả lời bãi đỗ xe được đặt trang trọng lên đầu rồi mới hiển thị kết quả tìm kiếm phòng.

### Vấn đề 4: Working Memory gây lem thông tin cũ vào câu hỏi mới (Cross-Turn Context Bleed)
- **Hiện tượng**: Lượt 1 khách tìm phòng có bồn tắm ở Hà Đông. Lượt 2 khách hỏi "giá phòng deluxe thế nào", bot lại đem bồn tắm và các thông số lượt 1 áp vào khiến câu trả lời bị lệch.
- **Root Cause**:
  - `memory.previous_search_results` và `memory.must_have_amenities` tồn tại vĩnh viễn trong phiên làm việc mà không phân định rõ ràng giữa "thông tin ngữ cảnh phiên" (Facility, Check-in date) và "yêu cầu của lượt hội thoại hiện tại" (Turn Intent & Parameters).
- **Giải pháp**:
  - Tách bạch cấu trúc Working Memory:
    - **Session-level Stable Context**: `active_facility`, `customer_name`, `booking_contact`.
    - **Active Turn Intent**: Chỉ có hiệu lực điều hướng câu trả lời trong lượt hiện tại.
    - **Turn-Scoped Output Filtering**: Khi intent lượt hiện tại là câu hỏi tra cứu danh mục hoặc chính sách, bot chỉ truy xuất schema định danh tương ứng, cô lập hoàn toàn kết quả tìm kiếm phòng của lượt trước.

### Vấn đề 5: Chat UI hiển thị thô dấu sao Markdown `**`
- **Hiện tượng**: Giao diện hiển thị tin nhắn khách hàng thấy các chuỗi `**Hạng phòng**`, `**Giá từ**` dạng text thô xấu xí và khó đọc.
- **Root Cause**:
  - `src/staff/server/dashboard-html.ts` chèn trực tiếp chuỗi text từ database/metadata vào thẻ HTML hoặc chỉ thay thế `\n` bằng `<br>`, không có bộ biên dịch Markdown an toàn.
- **Giải pháp**:
  - Xây dựng module `renderSafeMarkdown(content: string): string`:
    1. Escape các ký tự HTML nguy hiểm (`&`, `<`, `>`, `"`, `'`) để triệt tiêu lỗ hổng XSS.
    2. Chuyển đổi Markdown Bold `**text**` thành `<strong>text</strong>`.
    3. Chuyển đổi Markdown Italic `*text*` thành `<em>text</em>`.
    4. Hỗ trợ bullet list `- item` và xuống dòng `<br>`.
    5. Xử lý an toàn Markdown links `[title](url)`.

### Vấn đề 6: Giao diện chỉ hiển thị số ảnh thay vì hiển thị ảnh thực tế
- **Hiện tượng**: Bot phản hồi khách: `"- Số ảnh thực tế: 4 ảnh sắc nét"`, nhưng không hề có bức ảnh nào được gửi đến khách.
- **Root Cause**:
  - `advisory-composer.ts` trước đây tạo một dòng text mô tả `Số ảnh thực tế: ${room.anh.length} ảnh`, nhưng không trích xuất mảng URL ảnh từ `room.anh` để truyền sang metadata tin nhắn cho frontend render.
- **Giải pháp**:
  - Xóa bỏ câu text hứa hẹn suông "Số ảnh thực tế: ...".
  - Trích xuất trực tiếp danh sách URL ảnh thật từ Cloudflare R2 CDN trong dataset (`room.anh`).
  - Đóng gói cấu trúc `images: Array<{ url: string; alt?: string; roomName: string }>` vào `ConversationTurnResult` và lưu vào `MessageMetadata.images`.
  - Frontend render gallery thumbnail ảnh sắc nét, hỗ trợ click xem ảnh phóng to trong Lightbox modal.

---

## 3. BẢNG ĐỐI CHIẾU INTENT VS RESPONSE CONTRACT

| Intent | Input Mẫu | Action Được Áp Dụng | Response Contract Chuẩn | Ràng Buộc Bắt Buộc |
| :--- | :--- | :--- | :--- | :--- |
| `CHECK_ROOM_AVAILABILITY` | *"Hà Đông còn phòng đêm nay ko"* | `ANSWER_AVAILABILITY_TRANSPARENT` | Minh bạch chưa kết nối PMS trực tiếp; không giữ phòng ảo; giới thiệu 3 hạng phòng; hotline lễ tân. | **CẤM** tự gợi ý 1 phòng cụ thể; **CẤM** báo giá khi chưa hỏi. |
| `BROWSE_ROOM_CATEGORIES` | *"Bên em có những hạng phòng nào"* | `SHOW_ROOM_CATEGORIES` | Liệt kê 3 hạng chính thức: Standard, Deluxe, Concept. Nêu đặc trưng verified từ dataset. | **CẤM** gọi Concept là Suite. **CẤM** tự tính giá khi chưa hỏi. |
| `BROWSE_ROOMS_BY_CATEGORY` | *"Cho xem các phòng concept ở Hà Đông"* | `SHOW_ROOMS_BY_CATEGORY` | Liệt kê danh sách phòng thương mại theo hạng; dùng nguyên `ten_phong` canonical; tiện nghi verified. | **LOẠI BỎ** phòng 401 Hà Đông (NOT_FOR_SALE). Không tự báo giá. |
| `ASK_CATEGORY_PRICE` | *"Giá phòng deluxe thế nào em"* | `QUOTE_CATEGORY_PRICE` | Báo giá gốc theo V1.4.3 (2h đầu, thêm giờ, qua đêm); nhắc quy định tối thiểu 2h; hỏi thêm nhu cầu. | Báo đúng giá biểu V1.4.3 theo cơ sở; không nhầm lẫn giữa các hạng. |
| `ASK_SPECIFIC_ROOM_PRICE` | *"Phòng 601 giá qua đêm bao nhiêu"* | `GET_PREBOOKING_QUOTE` | Báo giá phòng cụ thể theo pricing category V1.4.3 và khung giờ quy định. | Báo giá chuẩn xác theo phân hạng tính giá. |
| `GET_ROOM_DETAILS` | *"Phòng 50 sắc thái có tiện nghi gì"* | `ANSWER_AMENITIES_DETAIL` | Mô tả chi tiết phòng, diện tích, giường, tiện nghi verified từ canonical dataset. | Giữ nguyên `ten_phong`. Không bịa tiện nghi không có trong dataset. |
| `REQUEST_ROOM_IMAGES` | *"Cho anh xem ảnh phòng 601"* | `SHOW_ROOM_IMAGES` | Trả lời giới thiệu ảnh kèm payload `images` chứa URL Cloudflare R2 thật. | Không gửi số lượng text suông. Payload `images` có URL hợp lệ. |
| `ASK_PARKING` | *"Bên em có chỗ đỗ ô tô không"* | `ANSWER_PARKING_POLICY` | Khẳng định: *"Dạ bên em có chỗ đỗ xe ạ."* | **CẤM** suy diễn khoảng cách, bãi xe 50m, mức phí; **CẤM** kèm gợi ý phòng. |
| `ASK_POLICY` | *"Mấy giờ nhận phòng qua đêm"* | `ANSWER_POLICY_QUESTION` | Trả lời chính sách khung giờ qua đêm từ 21:40 theo V1.4.3. | Trả lời ngắn gọn, chính xác, không nhầm lẫn giờ nhận phòng ngày (14:00). |
| `REQUEST_STAFF_HANDOFF` | *"Cho anh gặp nhân viên"* | `TRIGGER_HANDOFF` | Xác nhận chuyển tiếp yêu cầu đến nhân viên lễ tân hỗ trợ trực tiếp. | Không cố nài nỉ trả lời tự động khi khách yêu cầu người thật. |
| `BOOKING_REQUEST` | *"Anh muốn chốt đặt phòng này"* | `GUIDE_BOOKING_PROCESS` | Hướng dẫn liên hệ hotline/lễ tân để giữ phòng thực tế vì chưa có PMS tự động. | **CẤM** tự sinh mã booking giả lập; không xác nhận giữ chỗ khi chưa có PMS. |

---

## 4. CƠ CHẾ WORKING MEMORY & CONTEXT CONTROL

```
+-----------------------------------------------------------------------------------+
|                            CONVERSATION WORKING MEMORY                            |
+-----------------------------------------------------------------------------------+
|  [SESSION-LEVEL STABLE CONTEXT]                                                   |
|  - bound_property_id / active_facility: 'jacayl-ha-dong'                          |
|  - customer_name: 'Anh Nam'                                                      |
|  - target_date: '2026-11-23'                                                      |
|  - contact_phone: '0912345678'                                                    |
+-----------------------------------------------------------------------------------+
|  [ACTIVE TURN INTENT & PARAMETERS] (Turn-Scoped - Reset/Isolated Per Turn)        |
|  - active_intent: 'ASK_PARKING'                                                   |
|  - target_category: undefined                                                     |
|  - target_room: undefined                                                         |
+-----------------------------------------------------------------------------------+
|  [STALE PREVIOUS RESULTS] (Isolated - Never Bleeds Into Policy/Category Replies)  |
|  - previous_search_results: [Room 601, Room 502...]  -->  IGNORED WHEN NOT SEARCH |
|  - must_have_amenities: ['Bồn tắm']                 -->  IGNORED ON PURE INTENTS  |
+-----------------------------------------------------------------------------------+
```

### Nguyên tắc vận hành:
1. **Cô lập theo Intent**: Biến `shouldRunSearch` chỉ được kích hoạt khi intent là `SEARCH_ROOM` hoặc `RECOMMEND_ROOM`. Các intent như `ASK_PARKING`, `CHECK_ROOM_AVAILABILITY`, `BROWSE_ROOM_CATEGORIES`, `REQUEST_ROOM_IMAGES`, `ASK_POLICY` lập tức cưỡng chế `shouldRunSearch = false`.
2. **Khử nhiễm ngữ cảnh (De-contamination)**: Khi khách chuyển chủ đề từ tìm phòng sang hỏi tiện ích/chính sách, bộ nhớ tìm kiếm phòng cũ được giữ ở trạng thái lưu trữ nhưng **không bao giờ được chèn vào nội dung phản hồi của lượt mới**.
3. **Compound Query Handling**: Đối với câu hỏi kết hợp (ví dụ: vừa hỏi bãi đỗ xe vừa tìm phòng có ghế tình yêu), hệ thống:
   - Nhận diện `is_compound = true` và `asked_parking = true`.
   - Chạy tìm kiếm phòng phù hợp tiện nghi.
   - Khi compose phản hồi, đưa câu khẳng định bãi đỗ xe lên đầu: *"Dạ bên em có chỗ đỗ xe ạ. Về yêu cầu tìm phòng có ghế tình yêu tại Jacayl Hà Đông, em xin gợi ý..."*

---

## 5. CƠ CHẾ SERVER-SIDE PROPERTY CONTEXT BINDING

### Vấn đề trước đây:
Khi khách hàng nhắn tin trong một cuộc trò chuyện đã thuộc về cơ sở Hà Đông (`conv.propertyId = 'jacayl-ha-dong'`), nếu câu nói của khách không chứa từ "Hà Đông", NLU engine coi như chưa có cơ sở và hỏi khách: *"Dạ anh/chị đang quan tâm cơ sở nào bên em ạ?"*.

### Thiết kế giải pháp M4.2:
1. **Interface Binding**: Mở rộng `ProcessTurnOptions`:
   ```typescript
   export interface ProcessTurnOptions {
     referenceClock?: string;
     boundPropertyId?: CoSoMa;
   }
   ```
2. **Takeover Coordinator Injection**:
   ```typescript
   // src/staff/takeover/takeover-coordinator.ts
   const turnResult = await this.orchestrator.processTurn(
     conv.id,
     customerMessageContent,
     {
       referenceClock: options?.referenceClock,
       boundPropertyId: conv.propertyId, // Ràng buộc trực tiếp từ hội thoại
     }
   );
   ```
3. **Orchestrator Enforcement**:
   ```typescript
   // src/conversation/orchestrator.ts
   if (options?.boundPropertyId) {
     memory.active_facility = options.boundPropertyId;
   }
   ```
4. **Kết quả đạt được**:
   - Khách trong tab Hà Đông gõ: *"Có những hạng phòng nào em"* -> Bot lập tức trả lời 3 hạng phòng của **Jacayl Hà Đông**, tuyệt đối không hỏi lại cơ sở.
   - Khách gõ: *"Giá phòng deluxe thế nào"* -> Bot lập tức báo giá Deluxe của **Jacayl Hà Đông** (2h đầu 250k, thêm giờ 60k, qua đêm 400k), không bị nhầm giá La Casta hay cơ sở khác.

---

## 6. GIẢI PHÁP REAL IMAGE DELIVERY

### Nguồn dữ liệu hình ảnh thật:
Trong `data/j_collection_dataset.json`, mỗi phòng thương mại có trường `anh` chứa mảng đường dẫn Cloudflare R2 công khai. Ví dụ phòng 601 Hà Đông (`50 — Sắc Thái`):
```json
"anh": [
  "https://pub-2d6ec94e9f784d858dbd2b1f8fb54b39.r2.dev/Rooms/HaDong/Jacayl%20HaDong_50_Sac_Thai/Jacayl%20HaDong_50_Sac_Thai_1.jpg",
  "https://pub-2d6ec94e9f784d858dbd2b1f8fb54b39.r2.dev/Rooms/HaDong/Jacayl%20HaDong_50_Sac_Thai/Jacayl%20HaDong_50_Sac_Thai_2.jpg",
  "https://pub-2d6ec94e9f784d858dbd2b1f8fb54b39.r2.dev/Rooms/HaDong/Jacayl%20HaDong_50_Sac_Thai/Jacayl%20HaDong_50_Sac_Thai_3.jpg",
  "https://pub-2d6ec94e9f784d858dbd2b1f8fb54b39.r2.dev/Rooms/HaDong/Jacayl%20HaDong_50_Sac_Thai/Jacayl%20HaDong_50_Sac_Thai_4.jpg"
]
```

### Pipeline truyền dữ liệu hình ảnh:
```
[j_collection_dataset.json]
         |
         v
[Orchestrator: matchedRoom.anh]
         |
         v
[turnResult.images] : Array<{ url, alt, roomName }>
         |
         v
[TakeoverCoordinator: handleCustomerTurn]
         |
         v
[MessageMetadata.images] (Lưu trữ an toàn vào DB / InMemory Store)
         |
         v
[Dashboard HTML: msg-images-gallery]
  --> Render thẻ <img> kèm onerror fallback
  --> Hỗ trợ onclick mở modal phóng to ảnh
```

---

## 7. CẢI TIẾN CHAT UI & SAFE MARKDOWN RENDERER

### Module `renderSafeMarkdown`:
Triển khai tại `src/staff/server/dashboard-html.ts`:
```typescript
export function renderSafeMarkdown(content: string): string {
  if (!content) return '';
  // 1. Escape HTML chống XSS tuyệt đối
  let safe = content
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');

  // 2. Format Bold & Italic
  safe = safe.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
  safe = safe.replace(/\*(.*?)\*/g, '<em>$1</em>');

  // 3. Format Link an toàn
  safe = safe.replace(
    /\[(.*?)\]\((https?:\/\/[^\s]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>'
  );

  // 4. Format Bullet List & Line breaks
  safe = safe.replace(/^- (.*$)/gim, '• $1');
  safe = safe.replace(/\n/g, '<br>');

  return safe;
}
```

### Thư viện ảnh và Lightbox trên giao diện:
- Khi tin nhắn có `metadata.images`, một component `msg-images-gallery` được tạo tự động với các thumbnail bo tròn, có hiệu ứng hover phóng to nhẹ.
- Click vào bất kỳ ảnh nào sẽ kích hoạt modal Lightbox xem ảnh kích thước đầy đủ với nút đóng tiện lợi.

---

## 8. BÁO CÁO 20 ACCEPTANCE TEST SCENARIOS

Toàn bộ 20 kịch bản kiểm thử quy định tại Phần G đã được lập trình trong file `tests/m4_2-conversation-experience.test.ts` và **đạt 100% PASS**:

| STT | Kịch Bản Kiểm Thử | Trạng Thái | Chi Tiết Đạt Được |
| :---: | :--- | :---: | :--- |
| **S1** | Khách hỏi phòng trống không kích hoạt gợi ý phòng cụ thể | **PASS** | Báo chưa kết nối PMS, giới thiệu 3 hạng phòng, hotline, 0 phòng gợi ý, 0 báo giá. |
| **S2** | Khách hỏi phòng trống không tự báo giá | **PASS** | Không chứa bất kỳ mức giá nào (đồng, k, 000đ). |
| **S3** | Khung chat Hà Đông không hỏi chọn cơ sở | **PASS** | Đã bind `jacayl-ha-dong`, không hỏi lại cơ sở. |
| **S4** | Hỏi chỗ đỗ xe trả lời đúng hợp đồng, không kèm phòng | **PASS** | Đúng: "Dạ bên em có chỗ đỗ xe ạ.", không gợi ý phòng, không kèm giá. |
| **S5** | Khách hỏi các hạng phòng liệt kê đủ 3 hạng, không báo giá | **PASS** | Có Standard, Deluxe, Concept. Không gọi Concept là Suite. Không báo giá. |
| **S6** | Khách hỏi danh sách phòng concept Hà Đông | **PASS** | Liệt kê các phòng thương mại Concept, dùng tên canonical (50 — Sắc Thái). |
| **S7** | Danh sách phòng concept Hà Đông không chứa phòng 401 | **PASS** | Tuyệt đối không xuất hiện phòng 401 (NOT_FOR_SALE). |
| **S8** | Khách hỏi giá phòng deluxe Hà Đông | **PASS** | Báo giá chuẩn V1.4.3: 250k/2h đầu, 60k/h sau, 400k qua đêm. Có nhắc tối thiểu 2h. |
| **S9** | Khách yêu cầu xem ảnh phòng 601 trả về ảnh Cloudflare R2 thật | **PASS** | `images.length = 4`, URL chứa `r2.dev`, có alt và roomName chuẩn. |
| **S10** | Hỏi chỗ đỗ xe sau lượt tìm phòng không bị lem gợi ý cũ | **PASS** | Lượt 2 hỏi xe chỉ trả lời bãi đỗ xe, không lặp lại gợi ý phòng lượt 1. |
| **S11** | Báo giá qua đêm khi khách chỉ nói giờ | **PASS** | Tự động lấy reference clock giải quyết ngày, tính giá qua đêm chính xác. |
| **S12** | Đổi hạng phòng từ Deluxe sang Concept không bị lẫn lộn | **PASS** | Liệt kê đúng các phòng thuộc Concept, không chứa phòng Deluxe. |
| **S13** | Khách hỏi câu phức hợp (bãi xe + phòng bồn tắm) | **PASS** | Trả lời bãi xe trước, sau đó gợi ý phòng có bồn tắm. |
| **S14** | Khách hỏi chính sách nhận phòng qua đêm | **PASS** | Báo khung giờ qua đêm bắt đầu từ 21:40 theo V1.4.3. |
| **S15** | Khách hỏi về phòng 401 Hà Đông | **PASS** | Báo rõ ràng phòng 401 không kinh doanh / không mở bán. |
| **S16** | Khách yêu cầu gặp nhân viên kích hoạt handoff | **PASS** | Nhận diện đúng `REQUEST_STAFF_HANDOFF`, hướng dẫn kết nối nhân viên. |
| **S17** | Metadata tin nhắn lưu trữ đúng URL ảnh | **PASS** | Lưu trong `msg.metadata.images`, lấy ra qua API đúng 4 ảnh. |
| **S18** | Render Markdown an toàn không còn `**` thô | **PASS** | Chuyển `**` thành `<strong>`, an toàn trước `<script>`. |
| **S19** | Khách yêu cầu đặt phòng nhưng chưa có PMS | **PASS** | Không tự sinh mã đặt phòng giả, hướng dẫn liên hệ nhân viên. |
| **S20** | Tên phòng luôn dùng nguyên giá trị ten_phong canonical | **PASS** | Giữ nguyên từng ký tự `50 — Sắc Thái`, không tự dịch hay đổi tên. |

---

## 9. KẾT QUẢ REGRESSION TESTING TOÀN DIỆN

### Kết quả chạy kiểm thử toàn bộ dự án (`npx vitest run`):
```
 RUN  v3.2.7 C:/Chatbot

 ✓ tests/pricing-resolver.test.ts (34 tests)
 ✓ tests/gemini-provider.test.ts (7 tests)
 ✓ tests/m4-persistence-recovery.test.ts (3 tests)
 ✓ tests/overnight-advisory-multiturn.test.ts (3 tests)
 ✓ tests/canonical-room-identity.test.ts (11 tests)
 ✓ tests/golden-dialogues.test.ts (10 tests)
 ✓ tests/golden-multi-turn-extended.test.ts (2 tests)
 ✓ tests/m3_5-live-dialogue-evaluation.test.ts (15 tests)
 ✓ tests/conversation-evaluation.test.ts (16 tests)
 ✓ tests/m4_2-conversation-experience.test.ts (20 tests)
 ✓ tests/stay-package-eligibility.test.ts (10 tests)
 ✓ tests/business-policy-v1_4_3.test.ts (20 tests)
 ✓ tests/pricing-policy-loader.test.ts (8 tests)
 ✓ tests/free-llm-gateway.test.ts (9 tests)
 ✓ tests/adversarial-dialogues.test.ts (4 tests)
 ✓ tests/free-api-smoke.test.ts (2 tests)
 ✓ tests/invariants.test.ts (7 tests)
 ✓ tests/room-search.test.ts (9 tests)
 ✓ tests/ground-truth-hardening.test.ts (12 tests)
 ✓ tests/reference-resolver.test.ts (4 tests)
 ✓ tests/policy-consistency.test.ts (8 tests)
 ✓ tests/groq-provider.test.ts (7 tests)
 ✓ tests/nlu-engine.test.ts (10 tests)
 ✓ tests/transformer.test.ts (7 tests)
 ✓ tests/constraint-retraction.test.ts (4 tests)
 ✓ tests/pii-redaction.test.ts (7 tests)
 ✓ tests/temporal-resolver.test.ts (5 tests)
 ✓ tests/category-mapper.test.ts (5 tests)
 ✓ tests/memory-manager.test.ts (5 tests)
 ✓ tests/policy-qa.test.ts (23 tests)
 ✓ tests/dataset-audit.test.ts (11 tests)
 ✓ tests/claim-validator.test.ts (10 tests)
 ✓ tests/real-llm-gateway.test.ts (4 tests)
 ✓ tests/schema-validation.test.ts (5 tests)
 ✓ tests/m4-invariants-regression.test.ts (7 tests)
 ✓ tests/m4-human-takeover.test.ts (9 tests)
 ✓ tests/m4-staff-auth-isolation.test.ts (10 tests)
 ✓ tests/real-api-live-verification.test.ts (24 tests)

 Test Files  38 passed (38)
      Tests  367 passed (367)
   Start at  12:08:11
   Duration  53.28s
```

### Trạng thái biên dịch TypeScript (`npm run build`):
- Lệnh: `tsc`
- Kết quả: **Code 0**, hoàn toàn sạch lỗi cú pháp và kiểu dữ liệu.

---

## 10. CAM KẾT KHÔNG VI PHẠM BUSINESS POLICY & CANONICAL DATASET

1. **Bảo toàn Canonical Dataset**:
   - File `data/j_collection_dataset.json` hoàn toàn không bị chỉnh sửa hay ghi đè.
   - SHA-256 Hash xác thực: `22DF0EC50596E26FC7F7B2B889BFFF0A626C15E9C3EBD773684658FED38E44B6` (Khớp 100% với bản chuẩn).
2. **Bảo toàn Business Policy V1.4.3**:
   - Quy tắc nghỉ giờ tối thiểu 2 giờ được giữ vững.
   - Khung giờ nhận phòng qua đêm 21:40 được tuân thủ nghiêm ngặt.
   - Bảng giá nghỉ giờ, qua đêm, ngày đêm và phụ trội của cả 3 cơ sở (Hà Đông, La Casta, Triều Khúc) giữ nguyên vẹn.
3. **Canonical Room Identity Policy**:
   - Tên hiển thị luôn lấy nguyên từ `room.ten_phong` (ví dụ: `50 — Sắc Thái`, `101 — Lồng Chim`, `602 — Playboy`).
   - Phân biệt minh bạch giữa hạng phòng (`room.hang`: Standard, Deluxe, Concept) và hạng tính giá (`pricing_category`: Standard, Deluxe, Suite).
4. **Phòng không kinh doanh (NOT_FOR_SALE)**:
   - Phòng 401 Hà Đông tiếp tục bị chặn bán thương mại và không bao giờ xuất hiện trong danh sách đề xuất.
5. **Chính sách Free API & Bảo mật**:
   - Duy trì `FREE_ONLY_MODE=true`.
   - Tuyệt đối không lưu trữ, không in khóa API ra log, console, browser hay database.
   - Không phát sinh chi phí API.
