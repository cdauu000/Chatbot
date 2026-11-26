import { describe, it, expect, afterAll } from 'vitest';
import { existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { SqliteStore } from '../src/staff/persistence/sqlite-store.js';
import { AuthManager } from '../src/staff/auth/access-control.js';

describe('Milestone 4 — Persistence & Disaster Recovery Suite', () => {
  const testDbPath = join(process.cwd(), 'data', 'test_recovery_persistence.db');
  const backupSourceDbPath = join(process.cwd(), 'data', 'test_online_backup_source.db');
  const backupDbPath = join(process.cwd(), 'data', 'test_recovery_online_backup.db');

  const cleanupTestFiles = () => {
    for (const p of [
      testDbPath,
      `${testDbPath}-wal`,
      `${testDbPath}-shm`,
      backupSourceDbPath,
      `${backupSourceDbPath}-wal`,
      `${backupSourceDbPath}-shm`,
      backupDbPath,
      `${backupDbPath}-wal`,
      `${backupDbPath}-shm`,
    ]) {
      try {
        if (existsSync(p)) {
          unlinkSync(p);
        }
      } catch {
        // Ignore cleanup error
      }
    }
  };

  cleanupTestFiles();
  afterAll(cleanupTestFiles);

  it('Khởi chạy migrations an toàn và có tính lũy đẳng (Idempotent)', () => {
    const store = new SqliteStore({ dbPath: testDbPath });
    // Calling init/migrations again should not throw
    expect(() => store.init()).not.toThrow();
    store.close();
  });

  it('Bảo toàn trạng thái hội thoại và tin nhắn qua các lần khởi động lại (Cold Restart Recovery)', () => {
    // 1. First session: Create data
    const store1 = new SqliteStore({ dbPath: testDbPath });
    AuthManager.seedDefaultUsers(store1);

    const conv = store1.createConversation({
      id: 'cold-restart-conv-001',
      propertyId: 'j-village',
      customerName: 'Bác Hoàng',
      customerPhone: '0933112233',
      state: 'WAITING_FOR_STAFF',
    });

    store1.addMessage({
      conversationId: conv.id,
      senderType: 'customer',
      senderName: 'Bác Hoàng',
      content: 'Nhà tôi có nuôi 1 chú cún nhỏ thì có mang vào J Village được không?',
    });

    store1.addMessage({
      conversationId: conv.id,
      senderType: 'system',
      content: '⚠️ Yêu cầu lễ tân: Xác nhận chính sách thú cưng tại cơ sở.',
    });

    store1.addInternalNote({
      conversationId: conv.id,
      staffId: 'user_admin_001',
      staffName: 'Quản trị viên',
      content: 'Đã gọi trao đổi với quản lý cơ sở J Village về phụ thu thú cưng.',
    });

    store1.addAuditLog({
      conversationId: conv.id,
      propertyId: 'j-village',
      staffId: 'user_admin_001',
      staffName: 'Quản trị viên',
      action: 'ADD_INTERNAL_NOTE',
    });

    // Close first instance to simulate server shutdown
    store1.close();

    // 2. Second session: Cold restart on the same file
    const store2 = new SqliteStore({ dbPath: testDbPath });

    const recoveredConv = store2.getConversationById('cold-restart-conv-001');
    expect(recoveredConv).toBeDefined();
    expect(recoveredConv?.customerName).toBe('Bác Hoàng');
    expect(recoveredConv?.propertyId).toBe('j-village');
    expect(recoveredConv?.state).toBe('WAITING_FOR_STAFF');

    const recoveredMessages = store2.getMessagesByConversationId('cold-restart-conv-001');
    expect(recoveredMessages.length).toBe(2);
    expect(recoveredMessages[0].content).toContain('chú cún nhỏ');
    expect(recoveredMessages[1].senderType).toBe('system');

    const recoveredNotes = store2.getInternalNotesByConversationId('cold-restart-conv-001');
    expect(recoveredNotes.length).toBe(1);
    expect(recoveredNotes[0].content).toContain('phụ thu thú cưng');

    const recoveredLogs = store2.getAuditLogs({ conversationId: 'cold-restart-conv-001' });
    expect(recoveredLogs.length).toBe(1);
    expect(recoveredLogs[0].action).toBe('ADD_INTERNAL_NOTE');

    store2.close();
  });

  it('Xử lý khóa chống trùng lặp Idempotency Key chính xác', () => {
    const store = new SqliteStore({ dbPath: ':memory:' });

    const key = 'test-idemp-key-123';
    const firstCheck = store.checkAndSetIdempotencyKey(key, 60);
    expect(firstCheck).toBe(true);

    // Second check within TTL must return false
    const secondCheck = store.checkAndSetIdempotencyKey(key, 60);
    expect(secondCheck).toBe(false);

    store.close();
  });

  it('Tạo Online Backup nhất quán khi đang bật WAL và bảo toàn dữ liệu post-promote khi rollback', async () => {
    const store = new SqliteStore({ dbPath: backupSourceDbPath });
    const convPre = store.createConversation({
      id: 'backup-pre-promote-conv',
      propertyId: 'jacayl-ha-dong',
      customerName: 'Khách Trước Promote',
    });
    store.addMessage({
      conversationId: convPre.id,
      senderType: 'customer',
      content: 'Tin nhắn trước thời điểm promote.',
    });

    // Execute SQLite Online Backup API while primary connection & WAL journal stay open
    const pagesCopied = await store.createOnlineBackup(backupDbPath);
    expect(pagesCopied).toBeGreaterThan(0);

    // Simulate post-promote production activity written AFTER snapshot
    const convPost = store.createConversation({
      id: 'backup-post-promote-conv',
      propertyId: 'j-village',
      customerName: 'Khách Sau Promote',
    });
    store.addMessage({
      conversationId: convPost.id,
      senderType: 'customer',
      content: 'Dữ liệu phát sinh sau promote không được phép bị ghi đè mất.',
    });
    store.close();

    // Verify backup passes SQLite PRAGMA integrity_check and preserves pre-promote state cleanly
    const verifyBak = new DatabaseSync(backupDbPath);
    const integrity = verifyBak.prepare('PRAGMA integrity_check').get() as { integrity_check: string };
    expect(integrity.integrity_check).toBe('ok');
    const preInBak = verifyBak.prepare('SELECT id FROM conversations WHERE id = ?').get('backup-pre-promote-conv');
    const postInBak = verifyBak.prepare('SELECT id FROM conversations WHERE id = ?').get('backup-post-promote-conv');
    expect(preInBak).toBeDefined();
    expect(postInBak).toBeUndefined();
    verifyBak.close();

    // Verify live/post-promote DB keeps schema compatible & retains post-promote conversation untouched
    const verifyLive = new SqliteStore({ dbPath: backupSourceDbPath });
    expect(verifyLive.getConversationById('backup-post-promote-conv')?.customerName).toBe('Khách Sau Promote');
    verifyLive.close();
  });
});
