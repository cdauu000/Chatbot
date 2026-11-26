import '../src/config/env-loader.js';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { loadRawDataset } from '../src/data-loader/raw-loader.js';
import { transformRawDatasetToDomain } from '../src/domain/transformer.js';
import { FreeLLMGateway } from '../src/conversation/adapters/free-llm-gateway.js';
import { ConversationOrchestrator } from '../src/conversation/orchestrator.js';
import { SqliteStore } from '../src/staff/persistence/sqlite-store.js';
import { AuthManager } from '../src/staff/auth/access-control.js';
import { TakeoverCoordinator } from '../src/staff/takeover/takeover-coordinator.js';
import { DashboardServer } from '../src/staff/server/dashboard-server.js';

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  process.env.CONVERSATION_ENGINE = 'agentic';
  process.env.STRICT_LIVE_ONLY = 'true';
  if (process.env.FREE_ONLY_MODE === 'false') {
    throw new Error('FREE_ONLY_MODE must remain true');
  }

  const raw = loadRawDataset();
  const dataset = transformRawDatasetToDomain(raw);
  const store = new SqliteStore({ dbPath: ':memory:' });
  AuthManager.seedDefaultUsers(store);
  const authManager = new AuthManager(store);

  const gateway = new FreeLLMGateway({ mode: 'auto', freeOnlyMode: true });
  const orchestrator = new ConversationOrchestrator(dataset, { llmAdapter: gateway });
  const coordinator = new TakeoverCoordinator({ orchestrator, store });
  const server = new DashboardServer({
    port: 0,
    host: '127.0.0.1',
    store,
    authManager,
    takeoverCoordinator: coordinator,
    llmGateway: gateway,
  });

  const serverUrl = await server.start();
  const loginRes = await fetch(`${serverUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'Admin@JCollection2026!' }),
  });
  const { token } = (await loginRes.json()) as { token: string };

  const transcripts: any[] = [];
  const uiCheck: Record<string, any> = {};

  async function sendLiveTurn(params: {
    scenario: string;
    convId: string;
    propertyId: 'jacayl-ha-dong' | 'jacayl-tran-khat-chan' | 'j-village';
    message: string;
    referenceClock?: string;
  }) {
    let data: any = null;
    for (let attempt = 1; attempt <= 2; attempt++) {
      const res = await fetch(`${serverUrl}/api/simulate/customer-turn`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          conversationId: params.convId,
          propertyId: params.propertyId,
          content: params.message,
          clientMessageId: `live_${params.convId}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          referenceClock: params.referenceClock,
          customerName: `Verify (${params.scenario})`,
        }),
      });
      data = await res.json();
      if (res.ok && data?.aiMessage) break;
      if (attempt < 2) {
        console.log(`[RETRYING ${params.scenario}] transient provider error, waiting 15s...`);
        await sleep(15000);
      }
    }
    const aiMsg = data?.aiMessage;
    const entry = {
      scenario: params.scenario,
      conversationId: params.convId,
      propertyId: params.propertyId,
      referenceClockUsed: params.referenceClock ?? 'SERVER_WALL_CLOCK',
      userMessage: params.message,
      aiResponse: aiMsg?.content,
      telemetry: aiMsg?.metadata?.telemetry,
      roomPresentations: aiMsg?.metadata?.roomPresentations?.map((g: any) => ({
        roomId: g.roomId,
        roomCode: g.roomCode,
        roomName: g.roomName,
        displayOrder: g.displayOrder,
        imageCount: g.images?.length ?? 0,
        priceSummary: g.priceSummary,
      })),
      flatImagesCount: aiMsg?.metadata?.images?.length ?? 0,
    };
    transcripts.push(entry);
    console.log(
      `[${params.scenario}] ${aiMsg?.metadata?.telemetry?.provider}:${aiMsg?.metadata?.telemetry?.model} (${aiMsg?.metadata?.telemetry?.verificationStatus}) albums=${JSON.stringify(entry.roomPresentations || [])} -> ${String(aiMsg?.content || '').slice(0, 140).replace(/\n/g, ' ')}`
    );
    return data;
  }

  try {
    // 1. Owner Replay Session (mirrors real sim_1795601851439 flow)
    const ownerConv = 'owner_replay_v3_final';
    await sendLiveTurn({
      scenario: 'OWNER_REPLAY_0_STANDARD_LIST',
      convId: ownerConv,
      propertyId: 'jacayl-ha-dong',
      message: 'Cho xem phòng Standard',
      referenceClock: '2026-11-25T17:18:35+07:00',
    });
    await sleep(5000);

    await sendLiveTurn({
      scenario: 'OWNER_REPLAY_1_MEDIA_505_501_405',
      convId: ownerConv,
      propertyId: 'jacayl-ha-dong',
      message: 'cho xem 505501405',
      referenceClock: '2026-11-25T17:22:00+07:00',
    });
    await sleep(5000);

    await sendLiveTurn({
      scenario: 'OWNER_REPLAY_2_1722_7H_OVERNIGHT',
      convId: ownerConv,
      propertyId: 'jacayl-ha-dong',
      message: 'nếu 7h anh đến ở qua đêm thì giá thế nào',
      referenceClock: '2026-11-25T17:22:54+07:00',
    });
    await sleep(5000);

    await sendLiveTurn({
      scenario: 'OWNER_REPLAY_3_19H_CLARIFY',
      convId: ownerConv,
      propertyId: 'jacayl-ha-dong',
      message: '19h anh đến',
      referenceClock: '2026-11-25T17:23:37+07:00',
    });
    await sleep(5000);

    await sendLiveTurn({
      scenario: 'OWNER_REPLAY_4_BREAKFAST',
      convId: ownerConv,
      propertyId: 'jacayl-ha-dong',
      message: 'nhà mình có ăn sáng kh em',
      referenceClock: '2026-11-25T17:24:17+07:00',
    });
    await sleep(5000);

    // Gen #6 & #7: Contextual reference + photo-only (no price repeat)
    await sendLiveTurn({
      scenario: 'GEN_06_07_CONTEXTUAL_SECOND_AND_PHOTO_ONLY',
      convId: ownerConv,
      propertyId: 'jacayl-ha-dong',
      message: 'Căn thứ hai vừa gửi giá 2 tiếng tối nay bao nhiêu? Còn căn 405 chỉ gửi lại ảnh thôi không cần nhắc giá nhé.',
      referenceClock: '2026-11-25T17:25:00+07:00',
    });
    await sleep(5000);

    // 2. Playwright UI Verification of Owner Replay multi-room albums, Lightbox isolation & Reload persistence
    const screenshotsDir = path.resolve('artifacts', 'screenshots');
    fs.mkdirSync(screenshotsDir, { recursive: true });
    const browser = await chromium.launch({
      executablePath: fs.existsSync(CHROME_PATH) ? CHROME_PATH : undefined,
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    });
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto(serverUrl, { waitUntil: 'networkidle' });
    await page.fill('#login-username', 'admin');
    await page.fill('#login-password', 'Admin@JCollection2026!');
    await page.click('button:has-text("ĐĂNG NHẬP")');
    await page.locator('#login-overlay').waitFor({ state: 'hidden', timeout: 8000 });
    await page.locator('.conv-item').first().click();
    await page.locator('.room-album-block').first().waitFor({ state: 'visible', timeout: 8000 });

    const multiRoomMsg = page
      .locator('.msg-ai:has(.room-album-block[data-room-code="505"]):not(:has(.room-album-block[data-room-code="201"]))')
      .first();
    await multiRoomMsg.scrollIntoViewIfNeeded();
    await page.waitForTimeout(1500);
    const albumCount = await multiRoomMsg.locator('.room-album-block').count();
    const albumCodes = await multiRoomMsg.locator('.room-album-block').evaluateAll((els) =>
      els.map((el) => ({
        code: el.getAttribute('data-room-code'),
        title: el.querySelector('.room-album-title')?.textContent?.trim(),
        cards: el.querySelectorAll('.gallery-card').length,
      }))
    );
    await page.screenshot({ path: path.join(screenshotsDir, 'v3-final-room-albums-dashboard.png'), fullPage: false });

    // Click first photo in 501 album & navigate strictly within that album
    const album501 = multiRoomMsg.locator('.room-album-block[data-room-code="501"]');
    await album501.locator('.gallery-card').first().click();
    await page.locator('#lightbox-modal').waitFor({ state: 'visible', timeout: 5000 });
    const lbTitle = await page.locator('#lightbox-room-title').innerText();
    const lbCounterStart = await page.locator('#lightbox-counter').innerText();
    await page.click('#lightbox-next');
    await page.click('#lightbox-next');
    await page.click('#lightbox-next');
    const lbCounterEnd = await page.locator('#lightbox-counter').innerText();
    const lbNextDisabledAtEnd = await page.locator('#lightbox-next').isDisabled();
    await page.screenshot({ path: path.join(screenshotsDir, 'v3-final-room-album-lightbox.png'), fullPage: false });
    await page.click('.lightbox-close');

    // Reload browser and confirm albums persist via SQLite metadata
    await page.reload({ waitUntil: 'networkidle' });
    if (await page.locator('#login-overlay').isVisible()) {
      await page.fill('#login-username', 'admin');
      await page.fill('#login-password', 'Admin@JCollection2026!');
      await page.click('button:has-text("ĐĂNG NHẬP")');
      await page.locator('#login-overlay').waitFor({ state: 'hidden', timeout: 8000 });
    }
    await page.locator('.conv-item').first().click();
    await page.locator('.room-album-block').first().waitFor({ state: 'visible', timeout: 8000 });
    const afterReloadAlbums = await page
      .locator('.msg-ai:has(.room-album-block[data-room-code="505"]):not(:has(.room-album-block[data-room-code="201"]))')
      .first()
      .locator('.room-album-block')
      .count();

    Object.assign(uiCheck, {
      beforeReloadAlbums: albumCount,
      afterReloadAlbums,
      albumDetails: albumCodes,
      lightboxRoomTitle: lbTitle,
      lightboxCounterStart: lbCounterStart,
      lightboxCounterEnd: lbCounterEnd,
      lightboxNextDisabledAtEnd: lbNextDisabledAtEnd,
    });

    await page.close();
    await browser.close();

    // 3. Additional Generalization Scenarios (Section VI #1, #2, #3, #4, #8, #10)
    const tempConv = 'gen_temporal_expressions';
    await sendLiveTurn({
      scenario: 'GEN_01_7H_TOMORROW_MORNING',
      convId: tempConv,
      propertyId: 'jacayl-ha-dong',
      message: '7h sáng mai anh nhận phòng 201 ở 2 tiếng giá bao nhiêu?',
      referenceClock: '2026-11-25T17:30:00+07:00',
    });
    await sleep(5000);

    await sendLiveTurn({
      scenario: 'GEN_03_CHANGE_19H_TO_22H',
      convId: tempConv,
      propertyId: 'jacayl-ha-dong',
      message: 'Thế nếu anh đổi sang 22h tối nay ở qua đêm phòng 405 luôn thì sao?',
      referenceClock: '2026-11-25T17:30:00+07:00',
    });
    await sleep(5000);

    await sendLiveTurn({
      scenario: 'GEN_01B_LAT_NUA_RELATIVE',
      convId: 'gen_relative_time',
      propertyId: 'jacayl-ha-dong',
      message: 'Lát nữa anh ghé phòng 405 ở đến sáng mai thì tính gói nào em?',
      referenceClock: '2026-11-25T17:30:00+07:00',
    });
    await sleep(5000);

    await sendLiveTurn({
      scenario: 'GEN_02_10_GRACE_2140_AND_2000',
      convId: 'gen_grace_bounds',
      propertyId: 'jacayl-ha-dong',
      message: 'Phòng 405 nếu anh đến lúc 20h00 ở qua đêm thì hết bao nhiêu, còn nếu đợi 21h40 thì sao?',
      referenceClock: '2026-11-25T17:35:00+07:00',
    });
    await sleep(5000);

    await sendLiveTurn({
      scenario: 'GEN_08_TKC_202_BREAKFAST',
      convId: 'gen_tkc_202',
      propertyId: 'jacayl-tran-khat-chan',
      message: 'Phòng 202 bên Trần Khát Chân giá qua đêm bao nhiêu và có bao gồm ăn sáng không?',
      referenceClock: '2026-11-25T17:35:00+07:00',
    });
    await sleep(5000);

    await sendLiveTurn({
      scenario: 'GEN_08_JV_202_BREAKFAST',
      convId: 'gen_jv_202',
      propertyId: 'j-village',
      message: 'Phòng 202 bên J Village giá qua đêm và bữa sáng tính thế nào ạ?',
      referenceClock: '2026-11-25T17:35:00+07:00',
    });
  } finally {
    const out = {
      verified_at: new Date().toISOString(),
      strict_live_only: true,
      free_only_mode: true,
      ui_verification: uiCheck,
      gateway_reliability: gateway.getReliabilityMetrics(),
      transcripts,
    };
    const outPath = path.resolve('artifacts', 'live-temporal-media-verification.json');
    fs.writeFileSync(outPath, JSON.stringify(out, null, 2), 'utf8');
    console.log('\nSaved verification report to:', outPath);
    console.log('UI Check:', out.ui_verification);
    await server.stop().catch(() => {});
    store.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
