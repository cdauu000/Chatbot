import { describe, it, expect, afterAll } from 'vitest';
import { existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { SqliteStore } from '../src/staff/persistence/sqlite-store.js';
import { AuthManager } from '../src/staff/auth/access-control.js';

describe('Milestone 4 — Persistence & Disaster Recovery Suite', () => {
  const testDbPath = join(process.cwd(), 'data', 'test_recovery_persistence.db');

  afterAll(() => {
    try {
      if (existsSync(testDbPath)) {
        unlinkSync(testDbPath);
      }
    } catch {
      // Ignore cleanup error
    }
  });

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
});
