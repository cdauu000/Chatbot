import { describe, it, expect, beforeEach } from 'vitest';
import { SqliteStore } from '../src/staff/persistence/sqlite-store.js';
import { AuthManager } from '../src/staff/auth/access-control.js';
import { TakeoverCoordinator } from '../src/staff/takeover/takeover-coordinator.js';
import { ConversationOrchestrator } from '../src/conversation/orchestrator.js';
import { loadRawDataset } from '../src/data-loader/raw-loader.js';
import { transformRawDatasetToDomain } from '../src/domain/transformer.js';
import { DashboardServer } from '../src/staff/server/dashboard-server.js';
import { FreeLLMGateway } from '../src/conversation/adapters/free-llm-gateway.js';

describe('Milestone 4 — Invariants & REST API Integration Suite', () => {
  const raw = loadRawDataset();
  const dataset = transformRawDatasetToDomain(raw);
  const FIXED_CLOCK = '2026-11-28T10:00:00+07:00';

  let store: SqliteStore;
  let orchestrator: ConversationOrchestrator;
  let coordinator: TakeoverCoordinator;
  let authManager: AuthManager;
  let server: DashboardServer;
  let serverUrl: string;

  beforeEach(async () => {
    store = new SqliteStore({ dbPath: ':memory:' });
    AuthManager.seedDefaultUsers(store);
    authManager = new AuthManager(store);
    const gateway = new FreeLLMGateway({ mode: 'mock' });
    orchestrator = new ConversationOrchestrator(dataset, { llmAdapter: gateway });
    coordinator = new TakeoverCoordinator({ orchestrator, store });

    server = new DashboardServer({
      port: 0,
      host: '127.0.0.1',
      store,
      authManager,
      takeoverCoordinator: coordinator,
      llmGateway: gateway,
    });
    serverUrl = await server.start();
  });

  afterEach(async () => {
    if (server) {
      await server.stop();
    }
    if (store) {
      store.close();
    }
  });

  // --------------------------------------------------------------------------
  // 1. Business Policy V1.4.3 & Canonical Identity Invariants via Takeover Coordinator
  // --------------------------------------------------------------------------
  describe('Bảo đảm 100% Bất biến Nghiệp vụ qua Takeover Coordinator', () => {
    it('Phòng 401 Hà Đông giữ nguyên trạng thái NOT_FOR_SALE khi khách hỏi qua dashboard', async () => {
      const turn = await coordinator.handleCustomerTurn(
        'conv-test-401',
        'jacayl-ha-dong',
        'Phòng 401 ở Hà Đông giá bao nhiêu em?',
        { referenceClock: FIXED_CLOCK }
      );

      expect(turn.aiMessage).toBeDefined();
      expect(turn.aiMessage?.content.toLowerCase()).toMatch(/không sử dụng để kinh doanh|không nằm trong danh mục/);
      expect(turn.aiMessage?.content).not.toContain('đã đặt phòng thành công');
    });

    it('Phòng 601 Hà Đông hiển thị chuẩn xác "50 — Sắc Thái" từ dataset', async () => {
      const turn = await coordinator.handleCustomerTurn(
        'conv-test-601',
        'jacayl-ha-dong',
        'Cho anh xem thông tin phòng 601 Hà Đông',
        { referenceClock: FIXED_CLOCK }
      );

      expect(turn.aiMessage).toBeDefined();
      expect(turn.aiMessage?.content).toContain('50 — Sắc Thái');
      expect(turn.aiMessage?.content).not.toContain('Tổng Thống');
      expect(turn.aiMessage?.content).not.toContain('50 Shades');
    });

    it('Chính sách nghỉ giờ V1.4.3: giải thích quy định tối thiểu 2 giờ', async () => {
      const turn = await coordinator.handleCustomerTurn(
        'conv-test-1h',
        'jacayl-ha-dong',
        'Giá thuê 1 tiếng phòng 201 La Casta ở Hà Đông là bao nhiêu?',
        { referenceClock: FIXED_CLOCK }
      );

      expect(turn.aiMessage).toBeDefined();
      expect(turn.aiMessage?.content.toLowerCase()).toMatch(/tối thiểu 2 tiếng|không có gói riêng 1 tiếng/);
    });

    it('Khách hàng khiếu nại checkout tự động chuyển trạng thái WAITING_FOR_STAFF', async () => {
      const turn = await coordinator.handleCustomerTurn(
        'conv-test-escalation',
        'jacayl-tran-khat-chan',
        'Em ơi tiền phòng checkout tính sai rồi, bắt trả thêm phụ thu vô lý quá!',
        { referenceClock: FIXED_CLOCK }
      );

      expect(turn.state).toBe('WAITING_FOR_STAFF');
      const conv = store.getConversationById('conv-test-escalation');
      expect(conv?.state).toBe('WAITING_FOR_STAFF');

      const logs = store.getAuditLogs({ conversationId: 'conv-test-escalation' });
      expect(logs.some((l) => l.action === 'ESCALATION_TRIGGERED')).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // 2. HTTP REST API Endpoints & Property Scoping
  // --------------------------------------------------------------------------
  describe('REST API Dashboard & Phân quyền', () => {
    it('Lễ tân J Village bị từ chối khi cố tình truy vấn cuộc trò chuyện cơ sở Hà Đông (403 Forbidden)', async () => {
      // 1. Create a Ha Dong conversation
      store.createConversation({
        id: 'conv-hd-secret',
        propertyId: 'jacayl-ha-dong',
        channelUserId: 'cust-hd-01',
      });

      // 2. Login as staff_village
      const loginRes = await fetch(`${serverUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'staff_village', password: 'Staff@Village2026!' }),
      });
      const loginData = await loginRes.json();
      const villageToken = loginData.token;

      // 3. Attempt to fetch Ha Dong conversation detail -> 403 Forbidden!
      const detailRes = await fetch(`${serverUrl}/api/conversations/conv-hd-secret`, {
        headers: { Authorization: `Bearer ${villageToken}` },
      });
      expect(detailRes.status).toBe(403);
      const detailErr = await detailRes.json();
      expect(detailErr.error).toContain('không có quyền truy cập dữ liệu của cơ sở');
    });

    it('Admin truy cập được tất cả cuộc trò chuyện của cả 3 cơ sở', async () => {
      // Seed 1 conversation per property
      store.createConversation({ id: 'c-vlg', propertyId: 'j-village', channelUserId: 'u1' });
      store.createConversation({ id: 'c-tkc', propertyId: 'jacayl-tran-khat-chan', channelUserId: 'u2' });
      store.createConversation({ id: 'c-hd', propertyId: 'jacayl-ha-dong', channelUserId: 'u3' });

      // Login as admin
      const loginRes = await fetch(`${serverUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'admin', password: 'Admin@JCollection2026!' }),
      });
      const adminToken = (await loginRes.json()).token;

      const listRes = await fetch(`${serverUrl}/api/conversations`, {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      expect(listRes.status).toBe(200);
      const listData = await listRes.json();
      expect(listData.items.length).toBeGreaterThanOrEqual(3);
    });

    it('API Telemetry bảo vệ tuyệt đối bí mật API Key', async () => {
      const loginRes = await fetch(`${serverUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'admin', password: 'Admin@JCollection2026!' }),
      });
      const adminToken = (await loginRes.json()).token;

      const teleRes = await fetch(`${serverUrl}/api/telemetry`, {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      expect(teleRes.status).toBe(200);
      const teleData = await teleRes.json();

      expect(teleData.groq).toBeDefined();
      expect(teleData.gemini).toBeDefined();

      // Ensure NO API KEY is present in JSON payload
      const jsonStr = JSON.stringify(teleData);
      expect(jsonStr).not.toContain(process.env.GROQ_API_KEY || 'dummy');
      expect(jsonStr).not.toContain(process.env.GEMINI_API_KEY || 'dummy');
      expect(jsonStr).not.toContain('apiKey');
    });
  });
});
