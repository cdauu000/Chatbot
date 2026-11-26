# J Collection — V3.0 FINAL Windows Pilot Operations Guide

**Phiên bản kiến trúc:** `V3.0 FINAL` (`3.0.0-llm-native-final`) — Reasoning-first · Tool-driven · Business-controlled  
**Phạm vi Pilot:** Tư vấn khách hàng dùng dữ liệu tĩnh & Business Policy V1.4.3 tại **3 cơ sở** (`jacayl-ha-dong`, `jacayl-tran-khat-chan`, `j-village`) trên **Staff Dashboard**.  
**Giới hạn phạm vi:** Không kết nối PMS, không giữ/chốt phòng thật, không tích hợp Zalo/Facebook/OTA, luôn giữ `FREE_ONLY_MODE=true`.

---

## 1. Cấu hình môi trường (`.env` tại `C:\Chatbot\.env`)

Không commit `.env` lên Git và không in API key ra log/chat. Cấu hình chuẩn:

- `CONVERSATION_ENGINE=agentic`
- `FREE_ONLY_MODE=true`
- `LLM_PROVIDER=auto`
- `GROQ_API_KEY=<key từ console.groq.com>`
- `GROQ_MODEL=qwen/qwen3.8-27b` (mặc định code; có thể override nếu đánh giá `openai/gpt-oss-120b`)
- `GEMINI_API_KEY=<key từ aistudio.google.com>`
- `GEMINI_MODEL=gemini-3.5-flash-lite`
- `DASHBOARD_PORT=3000` (tùy chọn, mặc định `3000`)

**Thứ tự định tuyến Free API trong code (`FreeLLMGateway`):**
1. **Primary:** Google Gemini Free (`gemini-3.5-flash-lite`)
2. **Secondary:** Groq Free (`qwen/qwen3.8-27b`)
3. **Additional Fallback:** Google Gemini Free (`gemini-3.1-flash-lite`, bỏ qua nếu Gemini vừa chạm quota `429` theo key trong lượt hiện tại)
4. **Centralized In-Process Queue:** `FreeLLMGateway` tuần tự hóa lời gọi theo từng provider bằng FIFO queue nội bộ tiến trình kèm shared cooldown khi có `429`/`503`.

---

## 2. Quy trình Build, Khởi động & Restart Dashboard trên Windows (PowerShell)

Mỗi khi cập nhật code hoặc kéo bản build mới, **luôn build lại `dist/` và khởi động lại đúng tiến trình mới**:

```powershell
cd C:\Chatbot

# 1. Dừng tiến trình cũ đang giữ cổng 3000 (nếu có)
$conn = Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue
if ($conn) {
  Stop-Process -Id $conn.OwningProcess -Force
}

# 2. Build TypeScript -> dist/
npm.cmd run build

# 3. Khởi động Staff Dashboard bằng bản build mới nhất
npm.cmd run dashboard
```

Mở trình duyệt tại: `http://127.0.0.1:3000` (hoặc `http://localhost:3000`).

---

## 3. Kiểm tra Dashboard đang chạy đúng bản build `V3.0 FINAL`

1. Kiểm tra nhanh qua API telemetry (hoặc đăng nhập UI):
   - Tiêu đề giao diện phải hiển thị **`V3.0 FINAL`**.
   - `GET /api/telemetry` phải trả `"buildVersion": "3.0.0-llm-native-final"` cùng `routing` và `reliabilityMetrics` (tuyệt đối không lộ API key).
2. Tài khoản mặc định để test RBAC 3 cơ sở (seed bởi `AuthManager.seedDefaultUsers`):
   - **Admin (xem cả 3 cơ sở):** `admin` / `Admin@JCollection2026!`
   - **Lễ tân Hà Đông:** `staff_hadong` / `Staff@HaDong2026!`
   - **Lễ tân Trần Khát Chân:** `staff_tkc` / `Staff@TKC2026!`
   - **Lễ tân J Village:** `staff_village` / `Staff@Village2026!`
3. Kiểm tra badge telemetry dưới mỗi tin nhắn AI trong khung chat:
   - Phải hiển thị đủ 5 trường: `engine=<agentic|legacy> | <provider>:<model> | <verificationStatus> | <latencyMs>ms | trace=<traceId>`.

---

## 4. Vận hành Human Takeover & Quy trình khi Free API chạm Quota

- **Human Takeover (Bắt buộc khi khách yêu cầu gặp lễ tân/quản lý hoặc cần xác nhận phòng trống/chốt giữ phòng thực tế):**
  - Nhấn nút **`Tiếp quản (Takeover)`** trên phiên chat -> trạng thái chuyển `HUMAN_ACTIVE`. AI ngừng gửi tin nhắn (và các phản hồi AI đang chạy dở sẽ bị hủy bỏ theo `generation_version`).
  - Lễ tân đối soát phòng trống trên phần mềm lễ tân (PMS) riêng, rồi nhắn trực tiếp cho khách.
  - Chỉ nhấn mở lại AI (`AI_ACTIVE`) khi kết thúc xử lý thủ công.
- **Xử lý khi Free API chạm giới hạn (`429` / `503`):**
  - Free Tier bị giới hạn đồng thời ở mức dùng chung (~15 RPM Gemini theo project/key và ~8,000 TPM trên Groq Free cho một số model).
  - Centralized queue sẽ giảm xung đột burst giữa 3 cơ sở, tuy nhiên khi quá ngưỡng RPM/TPM/RPD:
    - Nếu không bật `STRICT_LIVE_ONLY=true`, hệ thống chuyển sang `DEGRADED_DETERMINISTIC_MODE` (hiển thị rõ trạng thái trên telemetry message) và bám sát dữ liệu tĩnh / Business Policy V1.4.3.
    - Nếu lễ tân thấy hàng loạt tin nhắn chuyển `DEGRADED_DETERMINISTIC_MODE` hoặc độ trễ cao bất thường, kiểm tra trạng thái provider trong cửa sổ **Telemetry Hệ Thống** trên Dashboard và thực hiện **Human Takeover** với các ca phức tạp cho tới khi quota hồi phục.

---

## 5. Checklist kiểm thử trước ca Pilot

```powershell
# Bộ kiểm thử offline đầy đủ (không đụng mạng / Free API)
npx.cmd vitest run --exclude "tests/e2e/**" --exclude "tests/real-api-live-verification.test.ts" --exclude "tests/free-api-smoke.test.ts" --exclude "tests/live-acceptance-20.test.ts"

# Kiểm thử E2E 3 cơ sở bằng Playwright + Free API thật (cần .env có key hợp lệ)
npx.cmd vitest run tests/e2e/agentic-v3-final-3property-e2e.test.ts
```
