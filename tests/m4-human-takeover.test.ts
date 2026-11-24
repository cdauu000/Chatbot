import { describe, it, expect, beforeEach } from 'vitest';
import { SqliteStore } from '../src/staff/persistence/sqlite-store.js';
import { AuthManager } from '../src/staff/auth/access-control.js';
import {
  TakeoverCoordinator,
  DuplicateMessageError,
  InvalidStateTransitionError,
} from '../src/staff/takeover/takeover-coordinator.js';
import { ConversationOrchestrator } from '../src/conversation/orchestrator.js';
import { loadRawDataset } from '../src/data-loader/raw-loader.js';
import { transformRawDatasetToDomain } from '../src/domain/transformer.js';
import { StaffUser } from '../src/staff/staff-types.js';

describe('Milestone 4 — Human Takeover & Concurrency Coordinator Suite', () => {
  const raw = loadRawDataset();
  const dataset = transformRawDatasetToDomain(raw);

  let store: SqliteStore;
  let coordinator: TakeoverCoordinator;
  let orchestrator: ConversationOrchestrator;

  const staffHadong: StaffUser = {
    id: 'u_staff_hd',
    username: 'staff_hadong',
    fullName: 'Lễ tân Jacayl Hà Đông',
    role: 'staff',
    propertyId: 'jacayl-ha-dong',
    isActive: true,
    createdAt: new Date().toISOString(),
  };

  const staffVillage: StaffUser = {
    id: 'u_staff_vlg',
    username: 'staff_village',
    fullName: 'Lễ tân J Village',
    role: 'staff',
    propertyId: 'j-village',
    isActive: true,
    createdAt: new Date().toISOString(),
  };

  beforeEach(() => {
    store = new SqliteStore({ dbPath: ':memory:' });
    AuthManager.seedDefaultUsers(store);
    orchestrator = new ConversationOrchestrator(dataset);
    coordinator = new TakeoverCoordinator({ orchestrator, store });
  });

  // --------------------------------------------------------------------------
  // 1. Takeover Workflow & State Transitions
  // --------------------------------------------------------------------------
  describe('Quy trình tiếp quản và chuyển đổi trạng thái', () => {
    it('Lễ tân tiếp quản thành công (AI_ACTIVE -> HUMAN_ACTIVE)', () => {
      const conv = store.createConversation({
        id: 'conv-takeover-01',
        propertyId: 'jacayl-ha-dong',
        channelUserId: 'user-01',
        customerName: 'Anh Long',
        state: 'AI_ACTIVE',
      });

      const updated = coordinator.takeoverConversation(conv.id, staffHadong);
      expect(updated.state).toBe('HUMAN_ACTIVE');
      expect(updated.assignedStaffId).toBe(staffHadong.id);
      expect(updated.assignedStaffName).toBe(staffHadong.fullName);
      expect(updated.aiGenerationVersion).toBe(2);

      // Audit log recorded
      const logs = store.getAuditLogs({ conversationId: conv.id });
      expect(logs.some((l) => l.action === 'TAKEOVER')).toBe(true);

      // System message inserted into thread
      const messages = store.getMessagesByConversationId(conv.id);
      expect(messages.some((m) => m.senderType === 'system' && m.content.includes('đã tiếp quản'))).toBe(true);
    });

    it('Lễ tân mở lại cho AI thành công (HUMAN_ACTIVE -> AI_ACTIVE)', () => {
      const conv = store.createConversation({
        id: 'conv-resume-01',
        propertyId: 'jacayl-ha-dong',
        channelUserId: 'user-02',
        state: 'HUMAN_ACTIVE',
      });

      const resumed = coordinator.resumeAI(conv.id, staffHadong);
      expect(resumed.state).toBe('AI_ACTIVE');
      expect(resumed.assignedStaffId).toBeUndefined();

      const logs = store.getAuditLogs({ conversationId: conv.id });
      expect(logs.some((l) => l.action === 'RESUME_AI')).toBe(true);
    });

    it('Đóng và mở lại cuộc trò chuyện thành công', () => {
      const conv = store.createConversation({
        id: 'conv-close-01',
        propertyId: 'jacayl-ha-dong',
        channelUserId: 'user-03',
        state: 'AI_ACTIVE',
      });

      const closed = coordinator.closeConversation(conv.id, staffHadong);
      expect(closed.state).toBe('CLOSED');

      // Cannot takeover closed conversation without reopening
      expect(() => coordinator.takeoverConversation(conv.id, staffHadong)).toThrowError(
        InvalidStateTransitionError
      );

      const reopened = coordinator.reopenConversation(conv.id, staffHadong);
      expect(reopened.state).toBe('AI_ACTIVE');
    });

    it('Từ chối nhân viên tiếp quản cuộc trò chuyện của cơ sở khác', () => {
      const conv = store.createConversation({
        id: 'conv-diff-prop',
        propertyId: 'jacayl-ha-dong',
        channelUserId: 'user-04',
      });

      // Staff Village attempts to take over Ha Dong conversation
      expect(() => {
        coordinator.takeoverConversation(conv.id, staffVillage);
      }).toThrowError(/không có quyền truy cập dữ liệu/);
    });
  });

  // --------------------------------------------------------------------------
  // 2. AI Outbound Suppression & Race-Condition In-Flight Discard
  // --------------------------------------------------------------------------
  describe('Ngăn chặn phản hồi AI khi tiếp quản & Hủy AI in-flight', () => {
    it('Khi ở HUMAN_ACTIVE, tin nhắn của khách không kích hoạt phản hồi từ AI', async () => {
      const conv = store.createConversation({
        id: 'conv-suppress-ai',
        propertyId: 'jacayl-ha-dong',
        channelUserId: 'user-05',
        state: 'HUMAN_ACTIVE',
      });

      const turn = await coordinator.handleCustomerTurn(
        conv.id,
        'jacayl-ha-dong',
        'Cho anh hỏi giá phòng 201 La Casta thế nào em?'
      );

      expect(turn.customerMessage).toBeDefined();
      expect(turn.aiMessage).toBeUndefined(); // AI outbound is completely suppressed
      expect(turn.state).toBe('HUMAN_ACTIVE');

      const messages = store.getMessagesByConversationId(conv.id);
      expect(messages.filter((m) => m.senderType === 'ai').length).toBe(0);
    });

    it('Hủy bỏ phản hồi AI đang xử lý (In-flight discard) khi Lễ tân bấm Tiếp quản giữa chừng', async () => {
      const conv = store.createConversation({
        id: 'conv-inflight-discard',
        propertyId: 'jacayl-ha-dong',
        channelUserId: 'user-06',
        state: 'AI_ACTIVE',
      });

      // Mock an orchestrator that triggers takeover in the middle of processing
      let takeoverHappened = false;
      const delayedOrchestrator = {
        processTurn: async () => {
          // Simulate staff clicking takeover while AI is "thinking"
          coordinator.takeoverConversation(conv.id, staffHadong);
          takeoverHappened = true;
          return {
            customer_visible_response: 'Đây là câu trả lời AI cũ bị xử lý chậm.',
            human_escalation: { needed: false },
            internal_trace: { adapter_used: 'mock', latency_ms: 100, applied_policy_id: 'v1' },
            evidence_references: [],
          } as any;
        },
      } as unknown as ConversationOrchestrator;

      const raceCoordinator = new TakeoverCoordinator({ orchestrator: delayedOrchestrator, store });

      const turnResult = await raceCoordinator.handleCustomerTurn(
        conv.id,
        'jacayl-ha-dong',
        'Phòng 601 Hà Đông có bồn tắm không em?'
      );

      expect(takeoverHappened).toBe(true);
      expect(turnResult.discarded).toBe(true);
      expect(turnResult.aiMessage).toBeUndefined(); // Discarded! Never saved!
      expect(turnResult.state).toBe('HUMAN_ACTIVE');

      // Verify DB does not contain the discarded AI message
      const messages = store.getMessagesByConversationId(conv.id);
      const aiMsgs = messages.filter((m) => m.senderType === 'ai');
      expect(aiMsgs.length).toBe(0);

      // Audit log records the in-flight discard event
      const logs = store.getAuditLogs({ conversationId: conv.id });
      expect(logs.some((l) => l.action === 'DISCARD_IN_FLIGHT_AI')).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // 3. Staff Messages & Duplicate Prevention
  // --------------------------------------------------------------------------
  describe('Gửi tin nhắn Lễ tân & Chống trùng lặp', () => {
    it('Chỉ cho phép Lễ tân gửi tin nhắn khi ở trạng thái HUMAN_ACTIVE', () => {
      const conv = store.createConversation({
        id: 'conv-staff-msg-01',
        propertyId: 'jacayl-ha-dong',
        channelUserId: 'user-07',
        state: 'AI_ACTIVE', // Not HUMAN_ACTIVE
      });

      expect(() => {
        coordinator.sendStaffMessage(conv.id, staffHadong, 'Xin chào quý khách!');
      }).toThrowError(InvalidStateTransitionError);

      // Now take over
      coordinator.takeoverConversation(conv.id, staffHadong);

      // Should succeed
      const msg = coordinator.sendStaffMessage(conv.id, staffHadong, 'Dạ em chào anh, em là lễ tân ca trực ạ!');
      expect(msg.senderType).toBe('staff');
      expect(msg.senderId).toBe(staffHadong.id);
      expect(msg.content).toContain('em là lễ tân ca trực');
    });

    it('Chặn tin nhắn trùng lặp qua clientMessageId (Duplicate Prevention)', () => {
      const conv = store.createConversation({
        id: 'conv-dup-msg-01',
        propertyId: 'jacayl-ha-dong',
        channelUserId: 'user-08',
        state: 'HUMAN_ACTIVE',
      });

      const clientMessageId = 'client-unique-msg-999';

      // First send succeeds
      const msg1 = coordinator.sendStaffMessage(conv.id, staffHadong, 'Tin nhắn đầu tiên', clientMessageId);
      expect(msg1).toBeDefined();

      // Second send with same ID throws DuplicateMessageError
      expect(() => {
        coordinator.sendStaffMessage(conv.id, staffHadong, 'Tin nhắn gửi lại bị lag mạng', clientMessageId);
      }).toThrowError(DuplicateMessageError);
    });

    it('Ghi chú nội bộ được lưu và kiểm toán chính xác', () => {
      const conv = store.createConversation({
        id: 'conv-note-01',
        propertyId: 'jacayl-ha-dong',
        channelUserId: 'user-09',
        state: 'HUMAN_ACTIVE',
      });

      const note = coordinator.addInternalNote(conv.id, staffHadong, 'Khách cần phòng tầng cao, view thoáng.');
      expect(note.id).toBeDefined();
      expect(note.content).toBe('Khách cần phòng tầng cao, view thoáng.');

      const notes = store.getInternalNotesByConversationId(conv.id);
      expect(notes.length).toBe(1);
      expect(notes[0].staffName).toBe(staffHadong.fullName);

      const logs = store.getAuditLogs({ conversationId: conv.id });
      expect(logs.some((l) => l.action === 'ADD_INTERNAL_NOTE')).toBe(true);
    });
  });
});
