# J Collection AI Concierge — Agentic Chatbot System

Hệ thống AI Concierge thông minh dành cho chuỗi khách sạn **J Collection** (J Village, Jacayl Hà Đông, Jacayl Trần Khát Chân), ứng dụng kiến trúc Agentic đa tác tử (Multi-Agent), công cụ giải ràng buộc (Constraint Solver), định giá tự động (Automated Pricing Oracle), hỗ trợ tiếp quản bởi nhân viên lễ tân (Staff Takeover) và tích hợp các LLM Gateway miễn phí (Groq Free Tier & Google Gemini Free Tier).

---

## 🚀 Tính Năng Chính

- **Multi-Agent Architecture**: Điều phối thông minh giữa các Agent chuyên biệt theo cơ sở (`j-village`, `jacayl-ha-dong`, `jacayl-tran-khat-chan`).
- **Automated Pricing Oracle**: Tính toán chính xác giá phòng theo gói (nghỉ giờ, qua đêm, ngày đêm, phụ thu thêm giờ, phụ thu người thứ 3).
- **Free LLM Gateway**: Kết nối linh hoạt Groq API (`openai/gpt-oss-20b`, `llama-3.3-70b-versatile`) và Google Gemini API (`gemini-3.5-flash-lite`, `gemini-3.8-flash`) với cơ chế fallback tự động.
- **Staff Dashboard & Human Takeover**: Bảng điều khiển quản trị thời gian thực với phân quyền theo cơ sở, cho phép nhân viên tiếp quản hội thoại (Human Takeover) và trả lại quyền cho AI mượt mà.
- **Privacy & Grounding**: Tự động ẩn danh thông tin nhạy cảm (PII Redaction) và kiểm chứng tính xác thực của thông tin trước khi phản hồi (Claim Validation).

---

## 📁 Cấu Trúc Thư Mục

```text
├── src/
│   ├── agent/            # Định nghĩa tác tử, công cụ (Tools) và Constraint Solver
│   ├── conversation/     # Bộ điều phối hội thoại, NLU, Memory, Adapter LLM
│   ├── data-loader/      # Tải dữ liệu JSON danh mục phòng và chính sách
│   ├── demo/             # Giao diện Chat CLI và Dashboard Demo
│   ├── domain/           # Schema, type và bộ chuyển đổi dữ liệu chuẩn
│   ├── knowledge/        # Cơ sở tri thức (Policy QA Engine)
│   ├── pricing/          # Engine tính toán giá và thẩm định điều kiện đặt phòng
│   ├── search/           # Tìm kiếm phòng theo ràng buộc và tiện ích
│   ├── staff/            # Máy chủ Staff Dashboard, xác thực nhân viên, SQLite store
│   └── testing/          # Phòng thí nghiệm đánh giá tự động (Autonomous Lab)
├── data/                 # Dữ liệu khách sạn và chính sách giá
├── docs/                 # Tài liệu kiến trúc Agentic chi tiết
├── scripts/              # Kịch bản kiểm thử API và trace
├── tests/                # Bộ kiểm thử đơn vị, tích hợp và E2E (Vitest + Playwright)
├── .env.example          # Mẫu cấu hình biến môi trường
└── package.json          # Cấu hình dự án và dependencies
```

---

## 🛠️ Cài Đặt & Khởi Chạy

### 1. Yêu Cầu Môi Trường
- Node.js >= 20.x
- npm hoặc pnpm

### 2. Cài Đặt Thư Viện
```bash
npm install
```

### 3. Cấu Hình Biến Môi Trường
Sao chép tệp `.env.example` thành `.env` và điền khóa API của bạn:
```bash
cp .env.example .env
```
> **Lưu ý quan trọng**: Tệp `.env` chứa API Key cá nhân và đã được đưa vào `.gitignore`, tuyệt đối không commit lên Git.

### 4. Build & Kiểm Thử
```bash
# Biên dịch TypeScript
npm run build

# Chạy toàn bộ test suite
npm run test

# Chạy kiểm thử trực tiếp với LLM API (nếu đã cấu hình khóa trong .env)
npm run test:live
```

### 5. Chạy Demo
```bash
# Khởi chạy giao diện Chat CLI
npm run chat

# Khởi chạy Staff Dashboard
npm run dashboard
```
