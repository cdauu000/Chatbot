import { randomUUID } from 'node:crypto';
import {
  Conversation,
  ConversationState,
  Message,
  StaffUser,
  PropertyId,
  AuditAction,
} from '../staff-types.js';
import { SqliteStore } from '../persistence/sqlite-store.js';
import { AuthManager, ForbiddenError } from '../auth/access-control.js';
import { ConversationOrchestrator } from '../../conversation/orchestrator.js';

export class DuplicateMessageError extends Error {
  constructor(message: string = 'Tin nhắn trùng lặp đã được tiếp nhận.') {
    super(message);
    this.name = 'DuplicateMessageError';
  }
}

export class InvalidStateTransitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidStateTransitionError';
  }
}

export interface TakeoverCoordinatorOptions {
  orchestrator: ConversationOrchestrator;
  store: SqliteStore;
}

export class TakeoverCoordinator {
  private orchestrator: ConversationOrchestrator;
  private store: SqliteStore;

  constructor(options: TakeoverCoordinatorOptions) {
    this.orchestrator = options.orchestrator;
    this.store = options.store;
  }

  // --------------------------------------------------------------------------
  // Human Takeover Workflow
  // --------------------------------------------------------------------------

  /**
   * Atomically takes over a conversation, disabling AI outbound replies and
   * invalidating any in-flight AI generation.
   */
  public takeoverConversation(conversationId: string, staffUser: StaffUser): Conversation {
    const conv = this.store.getConversationById(conversationId);
    if (!conv) {
      throw new Error(`Cuộc trò chuyện '${conversationId}' không tồn tại.`);
    }

    // Property isolation check
    AuthManager.enforcePropertyAccess(staffUser, conv.propertyId);

    if (conv.state === 'CLOSED') {
      throw new InvalidStateTransitionError('Không thể tiếp quản cuộc trò chuyện đã đóng. Vui lòng mở lại trước.');
    }

    if (conv.state === 'HUMAN_ACTIVE' && conv.assignedStaffId === staffUser.id) {
      return conv; // Already taken over by this staff
    }

    return this.store.transaction(() => {
      // Transition atomically and increment ai_generation_version to cancel any in-flight AI
      const updated = this.store.updateConversationState(conversationId, 'HUMAN_ACTIVE', {
        assignedStaffId: staffUser.id,
        assignedStaffName: staffUser.fullName,
        incrementAiVersion: true,
      });

      // System notification message in conversation thread
      this.store.addMessage({
        conversationId,
        senderType: 'system',
        content: `Nhân viên lễ tân ${staffUser.fullName} đã tiếp quản cuộc trò chuyện. Trợ lý AI tạm dừng phản hồi.`,
      });

      // Audit log
      this.store.addAuditLog({
        conversationId,
        propertyId: conv.propertyId,
        staffId: staffUser.id,
        staffName: staffUser.fullName,
        action: 'TAKEOVER',
        details: {
          previousState: conv.state,
          newState: 'HUMAN_ACTIVE',
          previousStaffId: conv.assignedStaffId,
        },
      });

      return updated!;
    });
  }

  /**
   * Resumes AI assistance. Must be an explicit staff action.
   */
  public resumeAI(conversationId: string, staffUser: StaffUser): Conversation {
    const conv = this.store.getConversationById(conversationId);
    if (!conv) {
      throw new Error(`Cuộc trò chuyện '${conversationId}' không tồn tại.`);
    }

    AuthManager.enforcePropertyAccess(staffUser, conv.propertyId);

    if (conv.state === 'CLOSED') {
      throw new InvalidStateTransitionError('Không thể mở lại AI cho cuộc trò chuyện đã đóng.');
    }

    return this.store.transaction(() => {
      // First transition to pending, then active, incrementing version
      this.store.updateConversationState(conversationId, 'AI_RESUME_PENDING');
      const updated = this.store.updateConversationState(conversationId, 'AI_ACTIVE', {
        assignedStaffId: null,
        assignedStaffName: null,
        incrementAiVersion: true,
      });

      this.store.addMessage({
        conversationId,
        senderType: 'system',
        content: `Nhân viên lễ tân đã hoàn tất hỗ trợ và chuyển lại cuộc trò chuyện cho Trợ lý AI.`,
      });

      this.store.addAuditLog({
        conversationId,
        propertyId: conv.propertyId,
        staffId: staffUser.id,
        staffName: staffUser.fullName,
        action: 'RESUME_AI',
        details: {
          previousState: conv.state,
          newState: 'AI_ACTIVE',
        },
      });

      return updated!;
    });
  }

  /**
   * Closes a conversation.
   */
  public closeConversation(conversationId: string, staffUser: StaffUser): Conversation {
    const conv = this.store.getConversationById(conversationId);
    if (!conv) {
      throw new Error(`Cuộc trò chuyện '${conversationId}' không tồn tại.`);
    }

    AuthManager.enforcePropertyAccess(staffUser, conv.propertyId);

    return this.store.transaction(() => {
      const updated = this.store.updateConversationState(conversationId, 'CLOSED', {
        incrementAiVersion: true,
      });

      this.store.addMessage({
        conversationId,
        senderType: 'system',
        content: `Cuộc trò chuyện đã được đóng bởi ${staffUser.fullName}.`,
      });

      this.store.addAuditLog({
        conversationId,
        propertyId: conv.propertyId,
        staffId: staffUser.id,
        staffName: staffUser.fullName,
        action: 'CLOSE_CONVERSATION',
        details: { previousState: conv.state },
      });

      return updated!;
    });
  }

  /**
   * Reopens a closed conversation.
   */
  public reopenConversation(conversationId: string, staffUser: StaffUser): Conversation {
    const conv = this.store.getConversationById(conversationId);
    if (!conv) {
      throw new Error(`Cuộc trò chuyện '${conversationId}' không tồn tại.`);
    }

    AuthManager.enforcePropertyAccess(staffUser, conv.propertyId);

    return this.store.transaction(() => {
      const updated = this.store.updateConversationState(conversationId, 'AI_ACTIVE', {
        incrementAiVersion: true,
      });

      this.store.addMessage({
        conversationId,
        senderType: 'system',
        content: `Cuộc trò chuyện đã được mở lại bởi ${staffUser.fullName}.`,
      });

      this.store.addAuditLog({
        conversationId,
        propertyId: conv.propertyId,
        staffId: staffUser.id,
        staffName: staffUser.fullName,
        action: 'REOPEN_CONVERSATION',
      });

      return updated!;
    });
  }

  // --------------------------------------------------------------------------
  // Message Handling
  // --------------------------------------------------------------------------

  /**
   * Sends a message from authorized hotel staff in HUMAN_ACTIVE mode.
   */
  public sendStaffMessage(
    conversationId: string,
    staffUser: StaffUser,
    content: string,
    clientMessageId?: string
  ): Message {
    const conv = this.store.getConversationById(conversationId);
    if (!conv) {
      throw new Error(`Cuộc trò chuyện '${conversationId}' không tồn tại.`);
    }

    // Property authorization
    AuthManager.enforcePropertyAccess(staffUser, conv.propertyId);

    if (conv.state !== 'HUMAN_ACTIVE') {
      throw new InvalidStateTransitionError(
        `Chỉ có thể gửi tin nhắn nhân viên khi ở trạng thái HUMAN_ACTIVE (hiện tại: ${conv.state}). Vui lòng bấm 'Tiếp quản' trước.`
      );
    }

    // Duplicate message prevention
    if (clientMessageId) {
      const allowed = this.store.checkAndSetIdempotencyKey(`msg:${clientMessageId}`, 300);
      if (!allowed) {
        throw new DuplicateMessageError(`Tin nhắn gửi trùng lặp (ID: ${clientMessageId}).`);
      }
    }

    const trimmed = content.trim();
    if (trimmed.length === 0) {
      throw new Error('Nội dung tin nhắn không được để trống.');
    }

    return this.store.transaction(() => {
      const msg = this.store.addMessage({
        conversationId,
        senderType: 'staff',
        senderId: staffUser.id,
        senderName: staffUser.fullName,
        content: trimmed,
        metadata: { clientMessageId },
      });

      this.store.updateConversationSnippet(conversationId, `Lễ tân: ${trimmed}`, msg.createdAt, false, true);

      this.store.addAuditLog({
        conversationId,
        propertyId: conv.propertyId,
        staffId: staffUser.id,
        staffName: staffUser.fullName,
        action: 'SEND_STAFF_MESSAGE',
        details: { messageId: msg.id },
      });

      return msg;
    });
  }

  /**
   * Adds an internal note visible only to hotel staff.
   */
  public addInternalNote(conversationId: string, staffUser: StaffUser, content: string) {
    const conv = this.store.getConversationById(conversationId);
    if (!conv) {
      throw new Error(`Cuộc trò chuyện '${conversationId}' không tồn tại.`);
    }

    AuthManager.enforcePropertyAccess(staffUser, conv.propertyId);

    const trimmed = content.trim();
    if (trimmed.length === 0) {
      throw new Error('Ghi chú nội bộ không được để trống.');
    }

    const note = this.store.addInternalNote({
      conversationId,
      staffId: staffUser.id,
      staffName: staffUser.fullName,
      content: trimmed,
    });

    this.store.addAuditLog({
      conversationId,
      propertyId: conv.propertyId,
      staffId: staffUser.id,
      staffName: staffUser.fullName,
      action: 'ADD_INTERNAL_NOTE',
      details: { noteId: note.id },
    });

    return note;
  }

  /**
   * Ingests an incoming customer message.
   * If HUMAN_ACTIVE: saves customer message and does NOT generate AI reply.
   * If AI_ACTIVE: generates AI reply with race-condition check (discards if staff took over in-flight).
   */
  public async handleCustomerTurn(
    conversationId: string,
    propertyId: PropertyId,
    content: string,
    options?: {
      clientMessageId?: string;
      referenceClock?: string;
      customerName?: string;
      customerPhone?: string;
    }
  ): Promise<{ customerMessage: Message; aiMessage?: Message; state: ConversationState; discarded: boolean }> {
    // Duplicate prevention
    if (options?.clientMessageId) {
      const allowed = this.store.checkAndSetIdempotencyKey(`cust:${options.clientMessageId}`, 300);
      if (!allowed) {
        throw new DuplicateMessageError(`Tin nhắn khách hàng bị trùng lặp (ID: ${options.clientMessageId}).`);
      }
    }

    // Ensure conversation exists or create one
    let conv = this.store.getConversationById(conversationId);
    if (!conv) {
      conv = this.store.createConversation({
        id: conversationId,
        propertyId,
        channel: 'simulated',
        channelUserId: conversationId,
        customerName: options?.customerName,
        customerPhone: options?.customerPhone,
        state: 'AI_ACTIVE',
      });
    }

    // Save customer message
    const customerMsg = this.store.addMessage({
      conversationId,
      senderType: 'customer',
      senderName: options?.customerName ?? 'Khách hàng',
      content: content.trim(),
      metadata: { clientMessageId: options?.clientMessageId },
    });

    // Update snippet and increment staff unread counter
    this.store.updateConversationSnippet(conversationId, content.trim(), customerMsg.createdAt, true, false);

    // If currently HUMAN_ACTIVE: suppress AI response completely
    if (conv.state === 'HUMAN_ACTIVE') {
      return {
        customerMessage: customerMsg,
        state: 'HUMAN_ACTIVE',
        discarded: false,
      };
    }

    // If CLOSED: do not generate AI response
    if (conv.state === 'CLOSED') {
      return {
        customerMessage: customerMsg,
        state: 'CLOSED',
        discarded: false,
      };
    }

    // Capture snapshot version before starting async AI generation
    const capturedVersion = conv.aiGenerationVersion;

    // Asynchronously execute AI turn via Orchestrator
    const turnResult = await this.orchestrator.processTurn(
      conversationId,
      content,
      {
        referenceClock: options?.referenceClock,
        boundPropertyId: conv.propertyId,
      }
    );

    // ATOMIC RACE CONDITION CHECK:
    // Re-fetch conversation state to ensure staff did not takeover while AI was processing!
    const freshConv = this.store.getConversationById(conversationId);
    if (
      !freshConv ||
      (freshConv.state !== 'AI_ACTIVE' && freshConv.state !== 'WAITING_FOR_STAFF') ||
      freshConv.aiGenerationVersion !== capturedVersion
    ) {
      // DISCARD in-flight AI response! Staff has taken over during inference!
      this.store.addAuditLog({
        conversationId,
        propertyId: conv.propertyId,
        staffId: 'system',
        staffName: 'AI Orchestrator',
        action: 'DISCARD_IN_FLIGHT_AI',
        details: {
          reason: 'Staff takeover occurred during AI inference',
          capturedVersion,
          currentVersion: freshConv?.aiGenerationVersion,
          currentState: freshConv?.state,
        },
      });

      return {
        customerMessage: customerMsg,
        state: freshConv ? freshConv.state : 'HUMAN_ACTIVE',
        discarded: true,
      };
    }

    // Check if human escalation was triggered by policy/dispute/request
    let nextState: ConversationState = 'AI_ACTIVE';
    if (turnResult.human_escalation?.needed) {
      nextState = 'WAITING_FOR_STAFF';
      this.store.updateConversationState(conversationId, 'WAITING_FOR_STAFF');

      this.store.addAuditLog({
        conversationId,
        propertyId: conv.propertyId,
        staffId: 'ai',
        staffName: 'Trợ lý AI Concierge',
        action: 'ESCALATION_TRIGGERED',
        details: {
          reasonCode: turnResult.human_escalation.reason_code,
          summary: turnResult.human_escalation.summary,
        },
      });
    }

    // Save AI outbound message
    const aiMsg = this.store.addMessage({
      conversationId,
      senderType: 'ai',
      senderName: 'J Collection Concierge',
      content: turnResult.customer_visible_response,
      metadata: {
        images: turnResult.images,
        telemetry: {
          provider: turnResult.internal_trace.adapter_used,
          model: turnResult.internal_trace.applied_policy_id ?? 'unknown',
          latencyMs: turnResult.internal_trace.latency_ms,
          tokensTotal: 0,
          isFallback: false,
        },
        escalation: turnResult.human_escalation,
        evidenceReferences: turnResult.evidence_references,
      },
    });

    this.store.updateConversationSnippet(
      conversationId,
      `AI: ${turnResult.customer_visible_response}`,
      aiMsg.createdAt,
      false,
      true
    );

    return {
      customerMessage: customerMsg,
      aiMessage: aiMsg,
      state: nextState,
      discarded: false,
    };
  }
}
