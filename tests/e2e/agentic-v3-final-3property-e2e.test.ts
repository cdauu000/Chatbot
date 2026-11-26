import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium, Browser, Page } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import '../../src/config/env-loader.js';
import { loadRawDataset } from '../../src/data-loader/raw-loader.js';
import { transformRawDatasetToDomain } from '../../src/domain/transformer.js';
import { FreeLLMGateway } from '../../src/conversation/adapters/free-llm-gateway.js';
import { ConversationOrchestrator } from '../../src/conversation/orchestrator.js';
import { SqliteStore } from '../../src/staff/persistence/sqlite-store.js';
import { AuthManager } from '../../src/staff/auth/access-control.js';
import { TakeoverCoordinator } from '../../src/staff/takeover/takeover-coordinator.js';
import { DashboardServer } from '../../src/staff/server/dashboard-server.js';

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

describe('J COLLECTION V3.0 FINAL — 3-Property Live Browser E2E Acceptance', () => {
  let browser: Browser;
  let page: Page;
  let server: DashboardServer;
  let store: SqliteStore;
  let serverUrl: string;
  let gateway: FreeLLMGateway;

  beforeAll(async () => {
    process.env.CONVERSATION_ENGINE = 'agentic';
    process.env.STRICT_LIVE_ONLY = 'true';

    const raw = loadRawDataset();
    const dataset = transformRawDatasetToDomain(raw);
    store = new SqliteStore({ dbPath: ':memory:' });
    AuthManager.seedDefaultUsers(store);
    const authManager = new AuthManager(store);

    gateway = new FreeLLMGateway({ mode: 'auto', freeOnlyMode: true });
    const orchestrator = new ConversationOrchestrator(dataset, { llmAdapter: gateway });
    const coordinator = new TakeoverCoordinator({ orchestrator, store });

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
    page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  }, 45000);

  afterAll(async () => {
    delete process.env.CONVERSATION_ENGINE;
    delete process.env.STRICT_LIVE_ONLY;
    if (page) await page.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
    if (server) await server.stop().catch(() => {});
    if (store) store.close();
  });

  it('verifies all 3 properties on live Dashboard UI (availability, quote, photos, requirement switch, human takeover)', async () => {
    const screenshotsDir = path.resolve('artifacts', 'screenshots');
    fs.mkdirSync(screenshotsDir, { recursive: true });

    await page.goto(serverUrl, { waitUntil: 'networkidle' });

    // Login as Admin to inspect & test all 3 properties sequentially in the browser
    await page.fill('#login-username', 'admin');
    await page.fill('#login-password', 'Admin@JCollection2026!');
    await page.click('button:has-text("ĐĂNG NHẬP")');
    await page.locator('#login-overlay').waitFor({ state: 'hidden', timeout: 8000 });

    // -------------------------------------------------------------------------
    // PROPERTY 1: JACAYL HÀ ĐÔNG (Availability + Photo Gallery + Requirement Change + Human Takeover)
    // -------------------------------------------------------------------------
    await page.selectOption('#sim-property-select', 'jacayl-ha-dong');
    await page.fill('#sim-input-text', 'Nay còn phòng kh b');
    await page.click('button:has-text("Gửi với tư cách Khách Hàng")');

    const hdAi1 = page.locator('.msg-ai .msg-bubble').nth(0);
    await hdAi1.waitFor({ state: 'visible', timeout: 30000 });
    const hdText1 = await hdAi1.innerText();
    expect(hdText1.toLowerCase()).toMatch(/lễ tân|pms|trống|danh mục/);
    expect(hdText1).not.toMatch(/chốt giữ phòng thành công|đã giữ phòng cho bạn/i);

    // Verify V3.0 FINAL header, telemetry modal buildVersion, and 5-field message telemetry UI tag
    const bodyHeaderText = await page.locator('body').innerText();
    expect(bodyHeaderText).toMatch(/V3\.0 FINAL/i);
    const firstTelTag = await page.locator('.msg-ai .telemetry-tag').nth(0).innerText();
    expect(firstTelTag).toMatch(/engine=/i);
    expect(firstTelTag).toMatch(/:/);
    expect(firstTelTag).toMatch(/LIVE_LLM_DECISION_VERIFIED|DETERMINISTIC/);
    expect(firstTelTag).toMatch(/\d+ms/);
    expect(firstTelTag).toMatch(/trace=/i);
    await page.evaluate(() => (window as any).openTelemetryModal());
    await page.waitForFunction(
      () => (document.getElementById('telemetry-content')?.innerText || '').includes('3.0.0-llm-native-final'),
      { timeout: 5000 }
    );
    const modalText = await page.locator('#telemetry-content').innerText();
    expect(modalText).toContain('3.0.0-llm-native-final');
    expect(modalText).toContain('gemini-3.5-flash-lite');
    expect(modalText).toContain('qwen/qwen3.8-27b');
    await page.evaluate(() => (window as any).closeTelemetryModal());

    await new Promise((r) => setTimeout(r, 12000));

    // Ask for photos & conditional price of Room 601
    await page.fill('#sim-input-text', 'Cho anh xem hình ảnh thực tế và giá 2 tiếng phòng 601 nhé');
    await page.click('button:has-text("Gửi với tư cách Khách Hàng")');

    const hdAi2 = page.locator('.msg-ai .msg-bubble').nth(1);
    await hdAi2.waitFor({ state: 'visible', timeout: 30000 });
    const hdText2 = await hdAi2.innerText();
    expect(hdText2).toMatch(/601|50\s*[—–-]?\s*Sắc Thái/i);
    expect(hdText2).toMatch(/399\.000|449\.000/);
    const imgCount = await page.locator('.gallery-card img.room-thumbnail').count();
    expect(imgCount).toBeGreaterThan(0);

    await new Promise((r) => setTimeout(r, 12000));

    // Requirement change to cheapest non-bathtub
    await page.fill('#sim-input-text', 'Thôi đổi lại tìm giúp anh phòng rẻ nhất ở Hà Đông đi');
    await page.click('button:has-text("Gửi với tư cách Khách Hàng")');

    const hdAi3 = page.locator('.msg-ai .msg-bubble').nth(2);
    await hdAi3.waitFor({ state: 'visible', timeout: 30000 });
    const hdText3 = await hdAi3.innerText();
    expect(hdText3).toMatch(/Standard|201|159\.000/);

    // Trigger Human Takeover and verify ZERO AI outbound after takeover
    const aiCountBeforeTakeover = await page.locator('.msg-ai .msg-bubble').count();
    await page.click('#btn-takeover');
    await page.locator('#takeover-banner').waitFor({ state: 'visible', timeout: 5000 });

    await page.fill('#sim-input-text', 'Alo lễ tân ơi kiểm tra giúp mình nhé');
    await page.click('button:has-text("Gửi với tư cách Khách Hàng")');
    await page.waitForTimeout(1500);
    const aiCountAfterTakeover = await page.locator('.msg-ai .msg-bubble').count();
    expect(aiCountAfterTakeover).toBe(aiCountBeforeTakeover);

    await page.screenshot({ path: path.join(screenshotsDir, 'v3-final-hadong-e2e.png'), fullPage: true });

    // -------------------------------------------------------------------------
    // PROPERTY 2: JACAYL TRẦN KHÁT CHÂN (Isolated context as staff_tkc)
    // -------------------------------------------------------------------------
    const tkcCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const tkcPage = await tkcCtx.newPage();
    await tkcPage.goto(serverUrl, { waitUntil: 'networkidle' });
    await tkcPage.fill('#login-username', 'staff_tkc');
    await tkcPage.fill('#login-password', 'Staff@TKC2026!');
    await tkcPage.click('button:has-text("ĐĂNG NHẬP")');
    await tkcPage.locator('#login-overlay').waitFor({ state: 'hidden', timeout: 8000 });

    await new Promise((r) => setTimeout(r, 10000));
    await tkcPage.selectOption('#sim-property-select', 'jacayl-tran-khat-chan');
    await tkcPage.fill('#sim-input-text', 'Phòng 1001 Đêm bên Trần Khát Chân giá qua đêm bao nhiêu và thứ 7 có tăng giá không em?');
    await tkcPage.click('button:has-text("Gửi với tư cách Khách Hàng")');

    const tkcAi = tkcPage.locator('.msg-ai .msg-bubble').first();
    await tkcAi.waitFor({ state: 'visible', timeout: 30000 });
    const tkcText = await tkcAi.innerText();
    expect(tkcText).toMatch(/1001|Đêm/i);
    expect(tkcText.toLowerCase()).toMatch(/không.*(tăng|phụ thu)|giữ nguyên|như ngày thường/);
    await tkcPage.screenshot({ path: path.join(screenshotsDir, 'v3-final-tkc-e2e.png'), fullPage: true });
    await tkcCtx.close();

    // -------------------------------------------------------------------------
    // PROPERTY 3: J VILLAGE (Isolated context as staff_village)
    // -------------------------------------------------------------------------
    const jvCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const jvPage = await jvCtx.newPage();
    await jvPage.goto(serverUrl, { waitUntil: 'networkidle' });
    await jvPage.fill('#login-username', 'staff_village');
    await jvPage.fill('#login-password', 'Staff@Village2026!');
    await jvPage.click('button:has-text("ĐĂNG NHẬP")');
    await jvPage.locator('#login-overlay').waitFor({ state: 'hidden', timeout: 8000 });

    await new Promise((r) => setTimeout(r, 10000));
    await jvPage.selectOption('#sim-property-select', 'j-village');
    await jvPage.fill('#sim-input-text', 'Phòng Crimson Suite bên J Village có bồn tắm không và gửi giúp mình ảnh với giá 2 tiếng nhé');
    await jvPage.click('button:has-text("Gửi với tư cách Khách Hàng")');

    const jvAi = jvPage.locator('.msg-ai .msg-bubble').first();
    await jvAi.waitFor({ state: 'visible', timeout: 30000 });
    const jvText = await jvAi.innerText();
    expect(jvText).toMatch(/Crimson Suite/i);
    expect(jvText).toMatch(/570\.000/);
    const jvImgs = await jvPage.locator('.gallery-card img.room-thumbnail').count();
    expect(jvImgs).toBeGreaterThan(0);

    // Check gateway live metrics (no deterministic fallback!)
    const metrics = gateway.getReliabilityMetrics();
    expect(metrics.groq.successes + metrics.gemini.successes).toBeGreaterThanOrEqual(4);

    await jvPage.screenshot({ path: path.join(screenshotsDir, 'v3-final-jvillage-e2e.png'), fullPage: true });
    await jvCtx.close();
  }, 180000);
});
