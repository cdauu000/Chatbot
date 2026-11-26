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

describe('AGENTIC V3.0 — Real Intelligence Browser E2E Acceptance Suite', () => {
  const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  const SCREENSHOT_DIR = path.resolve('artifacts/screenshots');
  const SCREENSHOT_FILE = path.join(SCREENSHOT_DIR, '11-v3-real-acceptance-e2e.png');

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
    process.env.STRICT_LIVE_ONLY = 'true';

    if (!fs.existsSync(SCREENSHOT_DIR)) {
      fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
    }

    const raw = loadRawDataset();
    const dataset = transformRawDatasetToDomain(raw);
    store = new SqliteStore({ dbPath: ':memory:' });
    AuthManager.seedDefaultUsers(store);
    authManager = new AuthManager(store);

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
    delete process.env.STRICT_LIVE_ONLY;
    if (page) await page.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
    if (server) await server.stop().catch(() => {});
    if (store) store.close();
  });

  it('V3.0 Browser E2E: Full Owner workflow on Staff Dashboard (Auth, Simulation, Takeover)', async () => {
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

    // 3. Send Owner Replay Question 1: "Nay còn phòng kh b"
    await page.fill('#sim-input-text', 'Nay còn phòng kh b');
    await page.click('button:has-text("Gửi với tư cách Khách Hàng")');

    // 4. Verify Customer Message in Staff Chat Window
    const customerMsg = page.locator('.msg-customer .msg-bubble').first();
    await customerMsg.waitFor({ state: 'visible', timeout: 10000 });
    expect(await customerMsg.innerText()).toContain('Nay còn phòng kh b');

    // 5. Verify Agentic AI Response in Staff Chat Window
    const aiMsg = page.locator('.msg-ai .msg-bubble').first();
    await aiMsg.waitFor({ state: 'visible', timeout: 20000 });
    const aiText = await aiMsg.innerText();
    console.log('\n[V3.0 Live E2E Browser Response - Turn 1]:\n', aiText);

    // Assert availability response characteristics:
    expect(aiText.toLowerCase()).toMatch(/lễ tân|đối soát/);
    expect(aiText).toMatch(/Standard|Deluxe|Concept/);
    expect(aiText).not.toContain('thứ 7 không cần bồn tắm');
    expect(aiText).not.toContain('chiều cuối tuần');

    // 6. Send Follow-up Turn: "Phòng 101 ở 4 tiếng giá thế nào em"
    await page.fill('#sim-input-text', 'Phòng 101 ở 4 tiếng giá thế nào em');
    await page.click('button:has-text("Gửi với tư cách Khách Hàng")');

    // Wait for 2nd AI message
    const secondAiMsg = page.locator('.msg-ai .msg-bubble').nth(1);
    await secondAiMsg.waitFor({ state: 'visible', timeout: 25000 });
    const aiText2 = await secondAiMsg.innerText();
    console.log('\n[V3.0 Live E2E Browser Response - Turn 2]:\n', aiText2);
    expect(aiText2).toContain('101');
    expect(aiText2).toMatch(/599\.000\s*(đ|VND)/i);
    expect(aiText2).toMatch(/649\.000\s*(đ|VND)/i);
    expect(aiText2).not.toContain('14:00');

    // 7. Human Takeover Test: Staff clicks "Tiếp quản"
    const takeoverBtn = page.locator('button:has-text("Tiếp quản cuộc trò chuyện")');
    if (await takeoverBtn.isVisible()) {
      await takeoverBtn.click();
      await page.waitForTimeout(1000);
      const stateBadge = page.locator('.badge-state, #conv-state-badge');
      if (await stateBadge.count() > 0) {
        expect(await stateBadge.first().innerText()).toMatch(/HUMAN_ACTIVE|TIẾP QUẢN/i);
      }
    }

    // 8. Capture Official V3.0 Real Acceptance Screenshot
    await page.screenshot({ path: SCREENSHOT_FILE, fullPage: true });
    expect(fs.existsSync(SCREENSHOT_FILE)).toBe(true);
    console.log(`\n[V3.0 SCREENSHOT SAVED] ${SCREENSHOT_FILE}`);
  }, 45000);
});
