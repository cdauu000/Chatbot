import { CoSoMa } from '../domain/types.js';
import { RoomPresentationBlock, RoomPresentationImage } from '../agent/agent-contracts.js';

export type PropertyId = CoSoMa; // 'j-village' | 'jacayl-tran-khat-chan' | 'jacayl-ha-dong'

export const PROPERTY_NAMES: Record<PropertyId, string> = {
  'j-village': 'J Village',
  'jacayl-tran-khat-chan': 'Jacayl Trần Khát Chân',
  'jacayl-ha-dong': 'Jacayl Hà Đông',
};

export type UserRole = 'admin' | 'staff';

export interface StaffUser {
  id: string;
  username: string;
  fullName: string;
  role: UserRole;
  propertyId: PropertyId | null; // null for admin (access all properties)
  isActive: boolean;
  createdAt: string;
}

export interface StaffUserWithCredentials extends StaffUser {
  passwordHash: string;
  salt: string;
}

export type ConversationState =
  | 'AI_ACTIVE'
  | 'WAITING_FOR_STAFF'
  | 'HUMAN_ACTIVE'
  | 'AI_RESUME_PENDING'
  | 'CLOSED';

export type ChannelType = 'simulated' | 'web' | 'zalo' | 'facebook';

export interface Conversation {
  id: string;
  propertyId: PropertyId;
  channel: ChannelType;
  channelUserId: string;
  customerName?: string;
  customerPhone?: string;
  state: ConversationState;
  assignedStaffId?: string;
  assignedStaffName?: string;
  unreadCountStaff: number;
  unreadCountCustomer: number;
  lastMessageSnippet?: string;
  lastMessageTimestamp: string;
  aiGenerationVersion: number;
  createdAt: string;
  updatedAt: string;
}

export type MessageSenderType = 'customer' | 'ai' | 'staff' | 'system';

export interface MessageMetadata {
  telemetry?: {
    engine?: string;
    traceId?: string;
    provider: string;
    model: string;
    verificationStatus?: string;
    effectivePolicyVersion?: string;
    latencyMs: number;
    tokensTotal: number;
    isFallback: boolean;
    fallbackReason?: string;
  };
  escalation?: {
    needed: boolean;
    reasonCode?: string;
    summary?: string;
  };
  evidenceReferences?: string[];
  clientMessageId?: string;
  images?: RoomPresentationImage[];
  roomPresentations?: RoomPresentationBlock[];
}

export interface Message {
  id: string;
  conversationId: string;
  senderType: MessageSenderType;
  senderId?: string;
  senderName?: string;
  content: string;
  metadata?: MessageMetadata;
  createdAt: string;
}

export interface InternalNote {
  id: string;
  conversationId: string;
  staffId: string;
  staffName: string;
  content: string;
  createdAt: string;
}

export type AuditAction =
  | 'LOGIN'
  | 'LOGOUT'
  | 'TAKEOVER'
  | 'RESUME_AI'
  | 'CLOSE_CONVERSATION'
  | 'REOPEN_CONVERSATION'
  | 'SEND_STAFF_MESSAGE'
  | 'ADD_INTERNAL_NOTE'
  | 'DISCARD_IN_FLIGHT_AI'
  | 'ESCALATION_TRIGGERED';

export interface AuditLog {
  id: string;
  conversationId?: string;
  propertyId?: PropertyId;
  staffId: string;
  staffName: string;
  action: AuditAction;
  details?: Record<string, any>;
  timestamp: string;
}

export interface ConversationFilter {
  propertyId?: PropertyId;
  state?: ConversationState | 'ALL';
  search?: string;
  assignedStaffId?: string;
  limit?: number;
  offset?: number;
}

export interface StaffAuthSession {
  token: string;
  user: StaffUser;
  expiresAt: number;
}
