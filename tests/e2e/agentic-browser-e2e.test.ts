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

describe('Real Browser E2E Acceptance — Agentic V1 Reasoning in Staff Dashboard', () => {
  const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  const SCREENSHOT_DIR = path.resolve('artifacts/screenshots');

  let browser: Browser;
  let page: Page;
  let server: DashboardServer;
  let serverUrl: string;
  let store: SqliteStore;
  let authManager: AuthManager;
  let orchestrator: ConversationOrchestrator;
  let coordinator: TakeoverCoordinator;

  beforeAll(async () => {
    process.env.CONVERSATION_ENGINE = 'agentic';

    if (!fs.existsSync(SCREENSHOT_DIR)) {
      fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
    }

    const raw = loadRawDataset();
    const dataset = transformRawDatasetToDomain(raw);
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

    browser = await chromium.launch({
      executablePath: CHROME_PATH,
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    });
    page = await browser.newPage({
      viewport: { width: 1440, height: 900 },
    });
  }, 40000);

  afterAll(async () => {
    delete process.env.CONVERSATION_ENGINE;
    if (page) await page.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
    if (server) await server.stop().catch(() => {});
    if (store) store.close();
  });

  it('E2E: Staff Hà Đông monitors Unseen Multi-Goal Reasoning Flow in live browser', async () => {
    await page.goto(serverUrl, { waitUntil: 'networkidle' });

    // 1. Login as Staff Hà Đông
    const loginOverlay = page.locator('#login-overlay');
    expect(await loginOverlay.isVisible()).toBe(true);

    await page.fill('#login-username', 'staff_hadong');
    await page.fill('#login-password', 'Staff@HaDong2026!');
    await page.click('button:has-text("ĐĂNG NHẬP")');

    await loginOverlay.waitFor({ state: 'hidden', timeout: 5000 });
    const displayName = page.locator('#user-display-name');
    expect(await displayName.innerText()).toContain('Jacayl Hà Đông');

    // 2. Select Jacayl Hà Đông property
    await page.selectOption('#sim-property-select', 'jacayl-ha-dong');

    // 3. Send Unseen Complex Customer Request
    const complexPrompt =
      'Anh muốn phòng lãng mạn ở Hà Đông có bồn tắm, nghỉ 4 tiếng chiều thứ Bảy, ngân sách 800 nghìn. Nếu phòng đầu tiên vượt tiền thì em tìm phương án gần nhất nhé.';
    await page.fill('#sim-input-text', complexPrompt);
    await page.click('button:has-text("Gửi với tư cách Khách Hàng")');

    // 4. Wait for customer message
    const customerMsg = page.locator('.msg-customer .msg-bubble').first();
    await customerMsg.waitFor({ state: 'visible', timeout: 8000 });
    expect(await customerMsg.innerText()).toContain('800 nghìn');

    // 5. Wait for Agentic AI message
    const aiMsg = page.locator('.msg-ai .msg-bubble').first();
    await aiMsg.waitFor({ state: 'visible', timeout: 10000 });

    const aiText = await aiMsg.innerText();
    console.log('Browser E2E Received AI Response:\n', aiText);

    // Verify key reasoning points
    expect(aiText).toContain('101 — Lồng Chim');
    expect(aiText).toContain('649.000đ');
    expect(aiText).toContain('800.000đ');
    expect(aiText).toContain('849.000đ');

    // 6. Capture Evidence Screenshot
    const screenshotPath = path.join(SCREENSHOT_DIR, '08-agentic-unseen-reasoning-flow.png');
    await page.screenshot({ path: screenshotPath, fullPage: true });
    expect(fs.existsSync(screenshotPath)).toBe(true);
  }, 35000);
});
