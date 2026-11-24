import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium, Browser, Page } from 'playwright';
import { SqliteStore } from '../../src/staff/persistence/sqlite-store.js';
import { AuthManager } from '../../src/staff/auth/access-control.js';
import { TakeoverCoordinator } from '../../src/staff/takeover/takeover-coordinator.js';
import { ConversationOrchestrator } from '../../src/conversation/orchestrator.js';
import { loadRawDataset } from '../../src/data-loader/raw-loader.js';
import { transformRawDatasetToDomain } from '../../src/domain/transformer.js';
import { DashboardServer } from '../../src/staff/server/dashboard-server.js';
import { FreeLLMGateway } from '../../src/conversation/adapters/free-llm-gateway.js';
import * as fs from 'fs';
import * as path from 'path';

describe('AGENTIC V1.2 — Strict Live Browser E2E Acceptance (Phase B)', () => {
  const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  const SCREENSHOT_DIR = path.resolve('artifacts/screenshots');
  const SCREENSHOT_FILE = path.join(SCREENSHOT_DIR, '09-agentic-v1-2-live-e2e.png');

  let browser: Browser;
  let page: Page;
  let server: DashboardServer;
  let serverUrl: string;
  let store: SqliteStore;
  let authManager: AuthManager;
  let orchestrator: ConversationOrchestrator;
  let coordinator: TakeoverCoordinator;
  let gateway: FreeLLMGateway;

  beforeAll(async () => {
    try {
      process.loadEnvFile?.();
    } catch {}

    process.env.CONVERSATION_ENGINE = 'agentic';

    if (!fs.existsSync(SCREENSHOT_DIR)) {
      fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
    }

    const raw = loadRawDataset();
    const dataset = transformRawDatasetToDomain(raw);
    store = new SqliteStore({ dbPath: ':memory:' });
    AuthManager.seedDefaultUsers(store);
    authManager = new AuthManager(store);

    // FreeLLMGateway in auto mode (Groq -> Gemini -> Free provider)
    gateway = new FreeLLMGateway({ mode: 'auto' });
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

    browser = await chromium.launch({
      executablePath: fs.existsSync(CHROME_PATH) ? CHROME_PATH : undefined,
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    });
    page = await browser.newPage({
      viewport: { width: 1440, height: 900 },
    });
  }, 45000);

  afterAll(async () => {
    delete process.env.CONVERSATION_ENGINE;
    if (page) await page.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
    if (server) await server.stop().catch(() => {});
    if (store) store.close();
  });

  it('Phase B Live E2E: Real Browser execution with model-driven reasoning and UI rendering', async () => {
    await page.goto(serverUrl, { waitUntil: 'networkidle' });

    // 1. Staff Authentication at Jacayl Hà Đông
    const loginOverlay = page.locator('#login-overlay');
    expect(await loginOverlay.isVisible()).toBe(true);

    await page.fill('#login-username', 'staff_hadong');
    await page.fill('#login-password', 'Staff@HaDong2026!');
    await page.click('button:has-text("ĐĂNG NHẬP")');

    await loginOverlay.waitFor({ state: 'hidden', timeout: 8000 });
    const displayName = page.locator('#user-display-name');
    expect(await displayName.innerText()).toContain('Jacayl Hà Đông');

    // 2. Select Jacayl Hà Đông Property in Simulator
    await page.selectOption('#sim-property-select', 'jacayl-ha-dong');

    // 3. Send Multi-Constraint Complex Customer Query
    const complexPrompt =
      'Anh muốn phòng lãng mạn ở Hà Đông có bồn tắm, nghỉ 4 tiếng chiều thứ Bảy, ngân sách 800 nghìn. Nếu phòng đầu tiên vượt tiền thì em tìm phương án gần nhất nhé.';
    await page.fill('#sim-input-text', complexPrompt);
    await page.click('button:has-text("Gửi với tư cách Khách Hàng")');

    // 4. Verify Customer Message in Staff Chat Window
    const customerMsg = page.locator('.msg-customer .msg-bubble').first();
    await customerMsg.waitFor({ state: 'visible', timeout: 10000 });
    expect(await customerMsg.innerText()).toContain('800 nghìn');

    // 5. Verify Agentic AI Response in Staff Chat Window
    const aiMsg = page.locator('.msg-ai .msg-bubble').first();
    await aiMsg.waitFor({ state: 'visible', timeout: 20000 });

    const aiText = await aiMsg.innerText();
    console.log('\n[Phase B Live E2E Browser Response]:\n', aiText);

    // 6. Assert Key Business Invariants & Replanning Logic
    expect(aiText).toContain('101 — Lồng Chim');
    expect(aiText).toContain('649.000đ');
    expect(aiText).toContain('849.000đ');
    expect(aiText.toLowerCase()).toContain('bồn tắm lớn');

    // 7. Verify Telemetry & State Integrity via HadongAgent
    const agent = orchestrator.getHadongAgent();
    // Locate the active session created by the simulator
    const simSessionId = 'sim-guest-session-1';
    const state = agent.getSessionState(simSessionId);
    expect(state).toBeDefined();

    // 8. Capture Official V1.2 Evidence Screenshot
    await page.screenshot({ path: SCREENSHOT_FILE, fullPage: true });
    expect(fs.existsSync(SCREENSHOT_FILE)).toBe(true);
    console.log(`\nScreenshot saved successfully to: ${SCREENSHOT_FILE}`);
  }, 45000);
});
