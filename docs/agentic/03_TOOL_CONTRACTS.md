# J COLLECTION — AGENT CONTRACTS & TOOL SPECIFICATION
**Tài liệu:** `docs/agentic/03_TOOL_CONTRACTS.md`  
**Phiên bản:** 1.0  
**Ngày ban hành:** 23/11/2026  
**Định hướng:** Reasoning-first · Tool-driven · Business-controlled  

---

## I. CHUẨN HÓA CÁC CORE AGENT INTERFACES

### 1. `AgentState`
Trạng thái làm việc của Agent xuyên suốt phiên hội thoại, lưu trữ tại backend:
```typescript
export interface AgentState {
  sessionId: string;
  channel: 'website' | 'zalo' | 'facebook' | 'cli';
  trustedPropertyId: CoSoMa; // 'jacayl-ha-dong' (Server-side enforced)
  guestGoal: string;
  hardConstraints: {
    budget?: number;
    checkinDatetime?: string; // ISO 8601
    durationHours?: number;
    stayType?: StayType;
    requiredAmenities: string[];
  };
  softPreferences: string[]; // ['lãng mạn', 'yên tĩnh', 'concept']
  currentCandidateRoomIds: string[];
  focusedRoomId: string | null;
  verifiedFacts: Record<string, Evidence>;
  observations: ToolObservation[];
  conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }>;
  lifecycle: 'DISCOVERY' | 'CONSULTATION' | 'ROOM_SHORTLIST' | 'BOOKING_GUIDANCE' | 'HUMAN_SUPERVISED' | 'CLOSED';
  handoffStatus: { needed: boolean; reason?: string };
  turnCount: number;
  updatedAt: number;
}
```

### 2. `AgentDecision`
Quyết định có cấu trúc do LLM đưa ra sau mỗi bước suy luận:
```typescript
export interface AgentDecision {
  reasoningSummary: string; // Tóm tắt ngắn gọn lý do chọn hành động (không chứa private CoT)
  actionType: 'CALL_TOOLS' | 'RESPOND_DIRECTLY' | 'CLARIFY' | 'ESCALATE';
  proposedToolCalls: ToolCall[];
  directResponseDraft?: string;
  requiresReplan?: boolean;
}
```

### 3. `ToolCall`
Lời gọi công cụ có cấu trúc:
```typescript
export interface ToolCall {
  toolCallId: string;
  toolName: 'search_rooms' | 'get_room_facts' | 'get_room_media' | 'get_policies' | 'quote_price';
  arguments: Record<string, any>;
}
```

### 4. `ToolResult`
Kết quả trả về từ Backend thực thi công cụ:
```typescript
export interface ToolResult {
  toolCallId: string;
  toolName: string;
  status: 'SUCCESS' | 'NO_DATA' | 'ERROR' | 'UNAUTHORIZED';
  data: any;
  provenance: string; // Nguồn dữ liệu (vd: 'dataset.phong', 'business_policy_v1_4_3.json')
  errorMessage?: string;
}
```

### 5. `Evidence`
Dữ kiện đã được kiểm chứng từ nguồn chính thức:
```typescript
export interface Evidence {
  subject: string;         // Thực thể (vd: 'phong:601-50-sac-thai')
  attribute: string;       // Thuộc tính (vd: 'bon_tam', 'gia_ngay_dem')
  value: any;              // Giá trị (vd: 'Bồn tắm lớn', 650000)
  status: 'VERIFIED' | 'DERIVED' | 'ESTIMATE' | 'UNKNOWN';
  sourceCitation: string;  // Nguồn trích dẫn (file:key)
  validForInterval?: string;
}
```

### 6. `BusinessClaim`
Khẳng định nghiệp vụ trong câu trả lời cần kiểm duyệt:
```typescript
export interface BusinessClaim {
  claimText: string;
  category: 'PRICE' | 'AVAILABILITY' | 'AMENITY' | 'POLICY' | 'URL' | 'CONTACT';
  evidenceId?: string;
  isValidated: boolean;
  rejectionReason?: string;
}
```

### 7. `AgentResponse`
Phản hồi cuối cùng gửi tới khách hàng:
```typescript
export interface AgentResponse {
  content: string; // Lời văn tự nhiên, trả lời trực diện, đúng phong thái lễ tân
  evidenceCitations: string[];
  suggestedActions?: string[];
  escalation?: { needed: boolean; reason?: string };
}
```

### 8. `DecisionTrace`
Bản ghi kiểm toán toàn bộ quá trình tư duy và thực thi của Agent:
```typescript
export interface DecisionTrace {
  turnIndex: number;
  providerModel: string;
  executionMode: 'FAST' | 'STANDARD' | 'DEEP';
  decisionSteps: Array<{
    step: number;
    phase: 'UNDERSTAND' | 'DECIDE' | 'ACT' | 'OBSERVE' | 'REVISE' | 'RESPOND';
    thoughtSummary: string;
    toolCalls?: ToolCall[];
    toolResults?: ToolResult[];
  }>;
  latencyMs: number;
  claimsChecked: {
    verifiedCount: number;
    disclaimedCount: number;
    rejectedCount: number;
    rejectedDetails: string[];
  };
}
```

---

## II. ĐẶC TẢ 5 READ-ONLY TOOLS CHO VERTICAL SLICE HÀ ĐÔNG

### 1. `search_rooms`
- **Mục đích:** Tìm danh sách phòng thỏa mãn các tiện nghi, hạng phòng và ngân sách.
- **Input Schema:**
  ```json
  {
    "property_id": { "type": "string", "enum": ["jacayl-ha-dong"] },
    "must_have_amenities": { "type": "array", "items": { "type": "string" } },
    "category": { "type": "string", "enum": ["Standard", "Deluxe", "Concept"], "optional": true },
    "max_budget": { "type": "number", "optional": true }
  }
  ```
- **Backend Rules:**
  - `property_id` luôn được backend ép cứng bằng `trustedPropertyId` của session (`jacayl-ha-dong`), bất chấp giá trị model gửi lên.
  - Tái sử dụng `InMemoryRoomSearchEngine`.
- **Output:** Danh sách phòng gồm mã phòng, tên phòng, hạng phòng, tiện nghi xác nhận, giá tham khảo cơ sở.

### 2. `get_room_facts`
- **Mục đích:** Đọc toàn bộ dữ kiện xác thực của một phòng cụ thể (tiện nghi, mô tả nguyên văn, nhãn bồn tắm).
- **Input Schema:**
  ```json
  {
    "property_id": { "type": "string" },
    "room_id": { "type": "string" }
  }
  ```
- **Backend Rules:**
  - Chỉ cho phép đọc phòng thuộc `jacayl-ha-dong`. Nếu `room_id` không thuộc cơ sở, trả về `UNAUTHORIZED` hoặc `NO_DATA`.
  - Trả về nhãn tiện nghi nguyên văn từ dataset (vd: phòng 601 trả về "Bồn tắm lớn", không tự biến đổi thành kích thước).

### 3. `get_room_media`
- **Mục đích:** Lấy danh sách ảnh đã kiểm duyệt và link xem phòng chính thức.
- **Input Schema:**
  ```json
  {
    "property_id": { "type": "string" },
    "room_id": { "type": "string" }
  }
  ```
- **Output:** Mảng URL ảnh từ CDN R2 chính thức và link đặt phòng website.

### 4. `get_policies`
- **Mục đích:** Tra cứu quy định khách sạn (chỗ đỗ xe, phụ thu thêm giờ, chính sách nhận/trả phòng, quy định ngày lễ).
- **Input Schema:**
  ```json
  {
    "property_id": { "type": "string" },
    "topic": { "type": "string", "enum": ["parking", "holiday", "cancellation", "stay_hours", "general"] }
  }
  ```
- **Output:** Quy định chính thức từ `j_collection_business_policy_v1_4_3.json`.

### 5. `quote_price`
- **Mục đích:** Tính giá chính xác tuyệt đối theo Business Policy V1.4.3 và Pricing Engine.
- **Input Schema:**
  ```json
  {
    "property_id": { "type": "string" },
    "room_id": { "type": "string" },
    "stay_type": { "type": "string", "enum": ["nghi_gio", "qua_dem", "ngay_dem"] },
    "duration_hours": { "type": "number", "minimum": 1 },
    "checkin_datetime": { "type": "string", "format": "date-time" }
  }
  ```
- **Backend Rules:**
  - Ủy quyền trực tiếp cho `PreBookingQuoteEngine.getQuote()`.
  - Áp dụng biểu giá cuối tuần / ngày thường, quy tắc ân hạn 10 phút, phụ thu thêm giờ phòng 601 (200k/h) vs 101 (100k/h).
  - Trả về số tiền VND, breakdown công thức và trạng thái tính giá.
