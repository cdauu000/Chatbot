import '../config/env-loader.js';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadRawDataset } from '../data-loader/raw-loader.js';
import { transformRawDatasetToDomain } from '../domain/transformer.js';
import { FreeLLMGateway } from '../conversation/adapters/free-llm-gateway.js';
import { ConversationOrchestrator } from '../conversation/orchestrator.js';
import { SqliteStore } from '../staff/persistence/sqlite-store.js';
import { AuthManager } from '../staff/auth/access-control.js';
import { TakeoverCoordinator } from '../staff/takeover/takeover-coordinator.js';
import { DashboardServer } from '../staff/server/dashboard-server.js';

export async function runDashboardDemo(): Promise<{
  server: DashboardServer;
  store: SqliteStore;
  url: string;
}> {
  console.log('='.repeat(70));
  console.log('  J COLLECTION CONCIERGE — MILESTONE 4 STAFF DASHBOARD DEMO');
  console.log('='.repeat(70));

  // 1. Ensure data directory exists
  const dataDir = join(process.cwd(), 'data');
  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true });
  }

  // 2. Load dataset & initialize AI Orchestrator
  console.log('⚙️  Đang tải Canonical Dataset và khởi động AI Core...');
  const raw = loadRawDataset();
  const dataset = transformRawDatasetToDomain(raw);
  const llmGateway = new FreeLLMGateway({ mode: 'auto' });
  const orchestrator = new ConversationOrchestrator(dataset, { llmAdapter: llmGateway });

  // 3. Initialize SQLite Persistent Store
  const dbPath = process.env.STAFF_DB_PATH || join(dataDir, 'staff_dashboard.db');
  console.log(`📁 Khởi tạo Persistent SQLite Database: ${dbPath}`);
  const store = new SqliteStore({ dbPath });
  const authManager = new AuthManager(store);
  const takeoverCoordinator = new TakeoverCoordinator({ orchestrator, store });

  // 4. Seed Default Staff Accounts
  console.log('👥 Nạp danh sách tài khoản Lễ tân & Quản trị mặc định...');
  AuthManager.seedDefaultUsers(store);

  // 5. Seed Initial Multi-Property Conversations (if store is empty)
  const existing = store.listConversations({ limit: 1 });
  if (existing.total === 0) {
    console.log('💬 Khởi tạo các cuộc trò chuyện mẫu cho 3 cơ sở...');

    // Property 1: J Village (AI_ACTIVE)
    const conv1 = store.createConversation({
      id: 'demo-village-001',
      propertyId: 'j-village',
      customerName: 'Anh Minh Tuấn',
      customerPhone: '0912345678',
      state: 'AI_ACTIVE',
    });
    store.addMessage({
      conversationId: conv1.id,
      senderType: 'customer',
      senderName: 'Anh Minh Tuấn',
      content: 'Chào em, cuối tuần này bên J Village còn phòng nào có bồn tắm đôi không?',
    });
    store.addMessage({
      conversationId: conv1.id,
      senderType: 'ai',
      senderName: 'J Collection Concierge',
      content: 'Dạ em chào anh Tuấn ạ! Tại cơ sở J Village bên em có các hạng phòng được trang bị bồn tắm nằm đôi thư giãn rất lãng mạn. Em xin gửi anh tham khảo các hạng phòng...',
    });
    store.updateConversationSnippet(conv1.id, 'AI: Dạ em chào anh Tuấn ạ! Tại cơ sở J Village...', new Date().toISOString(), true, false);

    // Property 2: Jacayl Trần Khát Chân (WAITING_FOR_STAFF - Escalated)
    const conv2 = store.createConversation({
      id: 'demo-tkc-002',
      propertyId: 'jacayl-tran-khat-chan',
      customerName: 'Chị Lan Hương',
      customerPhone: '0987654321',
      state: 'WAITING_FOR_STAFF',
    });
    store.addMessage({
      conversationId: conv2.id,
      senderType: 'customer',
      senderName: 'Chị Lan Hương',
      content: 'Em ơi hóa đơn checkout phòng 302 tính phụ thu thêm 150k là sao vậy em? Cho chị gặp lễ tân giải thích với!',
    });
    store.addMessage({
      conversationId: conv2.id,
      senderType: 'system',
      content: '⚠️ Yêu cầu trợ giúp: Khách hàng khiếu nại phụ thu checkout và yêu cầu gặp trực tiếp nhân viên lễ tân.',
    });
    store.updateConversationSnippet(conv2.id, 'Khách: Em ơi hóa đơn checkout phòng 302 tính phụ thu...', new Date().toISOString(), true, false);
    store.addInternalNote({
      conversationId: conv2.id,
      staffId: 'system',
      staffName: 'Hệ thống tự động',
      content: 'Khách thắc mắc phụ thu quá giờ 150k. Ca trực kiểm tra lại log PMS phòng 302.',
    });

    // Property 3: Jacayl Hà Đông (HUMAN_ACTIVE - Taken Over)
    const conv3 = store.createConversation({
      id: 'demo-hadong-003',
      propertyId: 'jacayl-ha-dong',
      customerName: 'Anh Đức Huy',
      customerPhone: '0901234567',
      state: 'HUMAN_ACTIVE',
    });
    store.updateConversationState(conv3.id, 'HUMAN_ACTIVE', {
      assignedStaffId: 'user_staff_hadong_001',
      assignedStaffName: 'Lễ tân Jacayl Hà Đông',
    });
    store.addMessage({
      conversationId: conv3.id,
      senderType: 'customer',
      senderName: 'Anh Đức Huy',
      content: 'Cho mình hỏi phòng 601 ở Hà Đông tên chính xác là gì?',
    });
    store.addMessage({
      conversationId: conv3.id,
      senderType: 'system',
      content: 'Nhân viên lễ tân Lễ tân Jacayl Hà Đông đã tiếp quản cuộc trò chuyện. Trợ lý AI tạm dừng phản hồi.',
    });
    store.addMessage({
      conversationId: conv3.id,
      senderType: 'staff',
      senderName: 'Lễ tân Jacayl Hà Đông',
      content: 'Dạ em chào anh Huy! Phòng 601 tại cơ sở Jacayl Hà Đông có tên chính thức là "50 — Sắc Thái" thuộc hạng Concept cao cấp ạ.',
    });
    store.updateConversationSnippet(conv3.id, 'Lễ tân: Dạ em chào anh Huy! Phòng 601...', new Date().toISOString(), false, true);
  }

  // 6. Start Server
  const port = parseInt(process.env.DASHBOARD_PORT ?? '3000', 10);
  const server = new DashboardServer({
    port,
    store,
    authManager,
    takeoverCoordinator,
    llmGateway,
  });

  const url = await server.start();

  console.log('\n' + '-'.repeat(70));
  console.log(`🚀 STAFF DASHBOARD ĐÃ KHỞI CHẠY THÀNH CÔNG TẠI:`);
  console.log(`   👉 ${url}`);
  console.log('-'.repeat(70));
  console.log('DANH SÁCH TÀI KHOẢN ĐĂNG NHẬP THỬ NGHIỆM:');
  console.log('  1. 👑 Tổng Quản Trị (Admin Toàn Quyền 3 Cơ Sở):');
  console.log('     Username: admin            | Password: Admin@JCollection2026!');
  console.log('  2. 🏨 Lễ Tân J Village (Chỉ Cơ Sở J Village):');
  console.log('     Username: staff_village    | Password: Staff@Village2026!');
  console.log('  3. 🏨 Lễ Tân Trần Khát Chân (Chỉ Cơ Sở TKC):');
  console.log('     Username: staff_tkc        | Password: Staff@TKC2026!');
  console.log('  4. 🏨 Lễ Tân Hà Đông (Chỉ Cơ Sở Jacayl Hà Đông):');
  console.log('     Username: staff_hadong     | Password: Staff@HaDong2026!');
  console.log('-'.repeat(70));
  console.log('TÍNH NĂNG CHÍNH ĐÃ SẴN SÀNG:');
  console.log('  • Phân quyền và cô lập dữ liệu đa cơ sở (Multi-Property Isolation)');
  console.log('  • Tiếp quản tức thì (Human Takeover) và vô hiệu hóa AI outbound');
  console.log('  • Hủy bỏ phản hồi AI đang xử lý dở khi có thao tác tiếp quản');
  console.log('  • Tab gửi tin nhắn giả lập Khách Hàng (Simulated Customer Chat)');
  console.log('  • Ghi chú nội bộ bàn giao ca (Internal Staff Notes)');
  console.log('  • Nhật ký thao tác kiểm toán bảo mật (Audit Logging)');
  console.log('  • Giám sát Free LLM Telemetry (Bảo mật tuyệt đối API Key)');
  console.log('='.repeat(70) + '\n');

  return { server, store, url };
}

// Auto-run if executed directly via CLI
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'))) {
  runDashboardDemo().catch((err) => {
    console.error('Fatal Demo Server Error:', err);
    process.exit(1);
  });
}
