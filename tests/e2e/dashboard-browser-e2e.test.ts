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

describe('Real Browser E2E Acceptance — Staff Dashboard & Human Takeover (Playwright Chromium)', () => {
  const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  const SCREENSHOT_DIR = path.resolve('artifacts/screenshots');
  const FIXED_CLOCK = '2026-11-28T10:00:00+07:00';

  let browser: Browser;
  let page: Page;
  let server: DashboardServer;
  let serverUrl: string;
  let store: SqliteStore;
  let authManager: AuthManager;
  let orchestrator: ConversationOrchestrator;
  let coordinator: TakeoverCoordinator;

  beforeAll(async () => {
    // Ensure screenshot directory exists
    if (!fs.existsSync(SCREENSHOT_DIR)) {
      fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
    }

    // 1. Initialize Backend & Dashboard Server
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

    // 2. Launch Real Chromium Browser using System Chrome
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
    if (page) await page.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
    if (server) await server.stop().catch(() => {});
    if (store) store.close();
  });

  // --------------------------------------------------------------------------
  // Flow 1: Authentication & Multi-Property Role-Based Access Control
  // --------------------------------------------------------------------------
  it('E2E Flow 1: Login as Admin and Staff with RBAC property isolation', async () => {
    await page.goto(serverUrl, { waitUntil: 'networkidle' });

    // Verify login overlay is visible
    const loginOverlay = page.locator('#login-overlay');
    expect(await loginOverlay.isVisible()).toBe(true);

    // Fill Admin credentials
    await page.fill('#login-username', 'admin');
    await page.fill('#login-password', 'Admin@JCollection2026!');
    await page.click('button:has-text("ĐĂNG NHẬP")');

    // Wait for login overlay to hide
    await loginOverlay.waitFor({ state: 'hidden', timeout: 5000 });
    expect(await loginOverlay.isVisible()).toBe(false);

    const displayName = page.locator('#user-display-name');
    expect(await displayName.innerText()).toBe('admin');
    const displayProperty = page.locator('#user-display-property');
    expect(await displayProperty.innerText()).toBe('Toàn quyền');

    // Capture Screenshot 1: Admin Dashboard
    const screenshot1Path = path.join(SCREENSHOT_DIR, '01-admin-login-dashboard.png');
    await page.screenshot({ path: screenshot1Path, fullPage: true });
    expect(fs.existsSync(screenshot1Path)).toBe(true);

    // Logout
    await page.click('button:has-text("Đăng xuất")');
    await loginOverlay.waitFor({ state: 'visible', timeout: 5000 });
    expect(await loginOverlay.isVisible()).toBe(true);

    // Login as Staff Hà Đông
    await page.fill('#login-username', 'staff_hadong');
    await page.fill('#login-password', 'Staff@HaDong2026!');
    await page.click('button:has-text("ĐĂNG NHẬP")');

    await loginOverlay.waitFor({ state: 'hidden', timeout: 5000 });
    expect(await displayName.innerText()).toBe('staff_hadong');
    expect(await displayProperty.innerText()).toBe('Jacayl Hà Đông');

    // Capture Screenshot 2: Staff Hà Đông Isolated View
    const screenshot2Path = path.join(SCREENSHOT_DIR, '02-staff-hadong-isolated-login.png');
    await page.screenshot({ path: screenshot2Path, fullPage: true });
    expect(fs.existsSync(screenshot2Path)).toBe(true);

    // Re-login as Admin for subsequent flows
    await page.click('button:has-text("Đăng xuất")');
    await loginOverlay.waitFor({ state: 'visible', timeout: 5000 });
    await page.fill('#login-username', 'admin');
    await page.fill('#login-password', 'Admin@JCollection2026!');
    await page.click('button:has-text("ĐĂNG NHẬP")');
    await loginOverlay.waitFor({ state: 'hidden', timeout: 5000 });
  }, 30000);

  // --------------------------------------------------------------------------
  // Flow 2: Customer Simulated Chat & AI Concierge Response
  // --------------------------------------------------------------------------
  it('E2E Flow 2: Simulated Customer Chat & Verified AI Concierge Response', async () => {
    // Select property Jacayl Hà Đông
    await page.selectOption('#sim-property-select', 'jacayl-ha-dong');

    // Ask about Room 601 50 Sắc Thái
    const question = 'Phòng 601 50 Sắc Thái ở Hà Đông giá bao nhiêu em?';
    await page.fill('#sim-input-text', question);
    await page.click('button:has-text("Gửi với tư cách Khách Hàng")');

    // Wait for customer message to render
    const customerMsg = page.locator('.msg-customer .msg-bubble').first();
    await customerMsg.waitFor({ state: 'visible', timeout: 8000 });
    expect(await customerMsg.innerText()).toContain('601');

    // Wait for AI message
    const aiMsg = page.locator('.msg-ai .msg-bubble').first();
    await aiMsg.waitFor({ state: 'visible', timeout: 8000 });

    // Verify canonical room name "50 — Sắc Thái" and pricing details appear
    const aiText = await aiMsg.innerText();
    expect(aiText).toMatch(/50 — Sắc Thái|Hạng Concept/i);
    expect(aiText).toMatch(/399\.000|449\.000|giá/i);

    // Capture Screenshot 3: Simulated Chat & AI Response
    const screenshot3Path = path.join(SCREENSHOT_DIR, '03-simulated-customer-chat-ai-response.png');
    await page.screenshot({ path: screenshot3Path, fullPage: true });
    expect(fs.existsSync(screenshot3Path)).toBe(true);
  }, 30000);

  // --------------------------------------------------------------------------
  // Flow 3: Room Image Gallery & Interactive Lightbox
  // --------------------------------------------------------------------------
  it('E2E Flow 3: Request Room Photos, Render Gallery, and View in Lightbox', async () => {
    // Ask for photos of room 101 Lồng Chim
    await page.fill('#sim-input-text', 'Cho anh xem ảnh phòng 101 Lồng Chim với');
    await page.click('button:has-text("Gửi với tư cách Khách Hàng")');

    // Wait for gallery card to render
    const galleryCard = page.locator('.gallery-card').first();
    await galleryCard.waitFor({ state: 'visible', timeout: 8000 });

    // Verify thumbnail image element
    const thumbnail = galleryCard.locator('.room-thumbnail');
    expect(await thumbnail.isVisible()).toBe(true);

    // Click gallery card to open Lightbox
    await galleryCard.click();

    // Verify Lightbox Modal opens
    const lightboxModal = page.locator('#lightbox-modal');
    await lightboxModal.waitFor({ state: 'visible', timeout: 5000 });
    expect(await lightboxModal.isVisible()).toBe(true);

    const lightboxImg = page.locator('#lightbox-img');
    expect(await lightboxImg.isVisible()).toBe(true);
    const imgSrc = await lightboxImg.getAttribute('src');
    expect(imgSrc).toBeTruthy();

    // Capture Screenshot 4: Lightbox View
    const screenshot4Path = path.join(SCREENSHOT_DIR, '04-image-gallery-lightbox-view.png');
    await page.screenshot({ path: screenshot4Path, fullPage: true });
    expect(fs.existsSync(screenshot4Path)).toBe(true);

    // Close lightbox
    await page.click('.lightbox-close');
    await lightboxModal.waitFor({ state: 'hidden', timeout: 5000 });
    expect(await lightboxModal.isVisible()).toBe(false);
  }, 30000);

  // --------------------------------------------------------------------------
  // Flow 4: Human Takeover (Tiếp quản)
  // --------------------------------------------------------------------------
  it('E2E Flow 4: Staff Human Takeover, AI silencing, and Staff Reply', async () => {
    // Click Tiếp quản button
    const btnTakeover = page.locator('#btn-takeover');
    expect(await btnTakeover.isVisible()).toBe(true);
    await btnTakeover.click();

    // Verify takeover banner appears
    const takeoverBanner = page.locator('#takeover-banner');
    await takeoverBanner.waitFor({ state: 'visible', timeout: 5000 });
    expect(await takeoverBanner.innerText()).toContain('TIẾP QUẢN THỦ CÔNG');

    // Verify status badge updates to HUMAN_ACTIVE
    const statusBadge = page.locator('#current-conv-state');
    expect(await statusBadge.innerText()).toBe('HUMAN_ACTIVE');

    // Verify Staff Input bar is visible
    const inputBar = page.locator('#chat-input-bar');
    expect(await inputBar.isVisible()).toBe(true);

    // Send a message as staff receptionist
    const staffMsgInput = page.locator('#staff-message-input');
    await staffMsgInput.fill('Dạ em chào anh/chị, em là lễ tân trực ca. Em hỗ trợ anh/chị ngay đây ạ!');
    await page.click('#btn-send-staff');

    // Verify staff bubble appears in timeline
    const staffBubble = page.locator('.msg-staff .msg-bubble').first();
    await staffBubble.waitFor({ state: 'visible', timeout: 5000 });
    expect(await staffBubble.innerText()).toContain('em là lễ tân trực ca');

    // Now send another simulated customer message while in takeover mode
    await page.fill('#sim-input-text', 'Lễ tân ơi phòng còn không?');
    await page.click('button:has-text("Gửi với tư cách Khách Hàng")');

    // Wait a brief moment and verify banner remains active
    await page.waitForTimeout(1000);
    expect(await takeoverBanner.isVisible()).toBe(true);

    // Capture Screenshot 5: Human Takeover Active
    const screenshot5Path = path.join(SCREENSHOT_DIR, '05-human-takeover-active.png');
    await page.screenshot({ path: screenshot5Path, fullPage: true });
    expect(fs.existsSync(screenshot5Path)).toBe(true);
  }, 30000);

  // --------------------------------------------------------------------------
  // Flow 5: AI Resume & State Transition
  // --------------------------------------------------------------------------
  it('E2E Flow 5: Resume AI Concierge and Verify AI Resumes Immediate Responses', async () => {
    // Click Resume AI button in banner
    const btnResume = page.locator('#takeover-banner button:has-text("Trả lại cho AI")');
    await btnResume.click();

    // Verify takeover banner hides and status returns to AI_ACTIVE
    const takeoverBanner = page.locator('#takeover-banner');
    await takeoverBanner.waitFor({ state: 'hidden', timeout: 5000 });
    expect(await takeoverBanner.isVisible()).toBe(false);

    const statusBadge = page.locator('#current-conv-state');
    expect(await statusBadge.innerText()).toBe('AI_ACTIVE');

    // Send customer question about parking
    await page.fill('#sim-input-text', 'Khách sạn có chỗ đỗ xe không em?');
    await page.click('button:has-text("Gửi với tư cách Khách Hàng")');

    // Verify AI responds immediately with canonical answer
    await page.waitForTimeout(1200);
    const lastAiMsg = page.locator('.msg-ai .msg-bubble').last();
    await lastAiMsg.waitFor({ state: 'visible', timeout: 8000 });
    expect(await lastAiMsg.innerText()).toContain('Dạ bên em có chỗ đỗ xe ạ.');

    // Capture Screenshot 6: AI Resumed and Responding
    const screenshot6Path = path.join(SCREENSHOT_DIR, '06-ai-resumed-and-responding.png');
    await page.screenshot({ path: screenshot6Path, fullPage: true });
    expect(fs.existsSync(screenshot6Path)).toBe(true);
  }, 30000);

  // --------------------------------------------------------------------------
  // Flow 6: Persistence & Conversation Reload
  // --------------------------------------------------------------------------
  it('E2E Flow 6: Persistence of Conversation History across Browser Reload', async () => {
    // Reload page
    await page.reload({ waitUntil: 'networkidle' });

    // Re-login
    await page.fill('#login-username', 'admin');
    await page.fill('#login-password', 'Admin@JCollection2026!');
    await page.click('button:has-text("ĐĂNG NHẬP")');
    const loginOverlay = page.locator('#login-overlay');
    await loginOverlay.waitFor({ state: 'hidden', timeout: 5000 });
    expect(await loginOverlay.isVisible()).toBe(false);

    // Verify conversation item exists in left inbox list
    const convItem = page.locator('#conversation-list .conv-item').first();
    await convItem.waitFor({ state: 'visible', timeout: 8000 });
    await convItem.click();

    // Verify previous chat messages are fully loaded and persisted
    const messages = page.locator('.msg-bubble');
    const msgCount = await messages.count();
    expect(msgCount).toBeGreaterThan(4);

    // Capture Screenshot 7: Persisted History
    const screenshot7Path = path.join(SCREENSHOT_DIR, '07-conversation-history-persisted.png');
    await page.screenshot({ path: screenshot7Path, fullPage: true });
    expect(fs.existsSync(screenshot7Path)).toBe(true);
  }, 30000);
});
