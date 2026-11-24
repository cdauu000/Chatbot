import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import {
  PropertyId,
  StaffUser,
  StaffUserWithCredentials,
  Conversation,
  ConversationState,
  ConversationFilter,
  Message,
  InternalNote,
  AuditLog,
  AuditAction,
} from '../staff-types.js';
import { runMigrations } from './migrations.js';

export interface SqliteStoreOptions {
  dbPath?: string; // ':memory:' or file path like './data/staff_dashboard.db'
  runMigrationsOnInit?: boolean;
}

export class SqliteStore {
  private db: DatabaseSync;

  constructor(options?: SqliteStoreOptions) {
    const dbPath = options?.dbPath ?? ':memory:';
    this.db = new DatabaseSync(dbPath);
    if (options?.runMigrationsOnInit !== false) {
      this.init();
    }
  }

  public init(): void {
    // Enable WAL mode for file-based DB if not in memory
    try {
      this.db.exec('PRAGMA journal_mode = WAL;');
      this.db.exec('PRAGMA foreign_keys = ON;');
    } catch {
      // Ignored for in-memory or already configured DB
    }
    runMigrations(this.db);
  }

  public close(): void {
    try {
      this.db.close();
    } catch {
      // Ignore already closed error
    }
  }

  public getRawDb(): DatabaseSync {
    return this.db;
  }

  public transaction<T>(callback: () => T): T {
    this.db.exec('BEGIN TRANSACTION;');
    try {
      const result = callback();
      this.db.exec('COMMIT;');
      return result;
    } catch (err) {
      try {
        this.db.exec('ROLLBACK;');
      } catch {
        // Rollback error ignored
      }
      throw err;
    }
  }

  // --------------------------------------------------------------------------
  // Staff Users
  // --------------------------------------------------------------------------

  public findUserByUsername(username: string): StaffUserWithCredentials | null {
    const row = this.db
      .prepare('SELECT * FROM staff_users WHERE username = ? AND is_active = 1 LIMIT 1;')
      .get(username) as any;
    if (!row) return null;
    return {
      id: row.id,
      username: row.username,
      fullName: row.full_name,
      role: row.role as any,
      propertyId: row.property_id as PropertyId | null,
      passwordHash: row.password_hash,
      salt: row.salt,
      isActive: Boolean(row.is_active),
      createdAt: row.created_at,
    };
  }

  public getUserById(id: string): StaffUser | null {
    const row = this.db
      .prepare('SELECT id, username, full_name, role, property_id, is_active, created_at FROM staff_users WHERE id = ? LIMIT 1;')
      .get(id) as any;
    if (!row) return null;
    return {
      id: row.id,
      username: row.username,
      fullName: row.full_name,
      role: row.role as any,
      propertyId: row.property_id as PropertyId | null,
      isActive: Boolean(row.is_active),
      createdAt: row.created_at,
    };
  }

  public createUser(user: StaffUserWithCredentials): void {
    this.db
      .prepare(
        `INSERT INTO staff_users (id, username, full_name, role, property_id, password_hash, salt, is_active, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);`
      )
      .run(
        user.id,
        user.username,
        user.fullName,
        user.role,
        user.propertyId,
        user.passwordHash,
        user.salt,
        user.isActive ? 1 : 0,
        user.createdAt
      );
  }

  public listUsers(): StaffUser[] {
    const rows = this.db
      .prepare('SELECT id, username, full_name, role, property_id, is_active, created_at FROM staff_users ORDER BY username ASC;')
      .all() as any[];
    return rows.map((r) => ({
      id: r.id,
      username: r.username,
      fullName: r.full_name,
      role: r.role,
      propertyId: r.property_id,
      isActive: Boolean(r.is_active),
      createdAt: r.created_at,
    }));
  }

  // --------------------------------------------------------------------------
  // Conversations
  // --------------------------------------------------------------------------

  public createConversation(data: {
    id?: string;
    propertyId: PropertyId;
    channel?: string;
    channelUserId?: string;
    customerName?: string;
    customerPhone?: string;
    state?: ConversationState;
  }): Conversation {
    const id = data.id ?? randomUUID();
    const now = new Date().toISOString();
    const state = data.state ?? 'AI_ACTIVE';
    const channel = data.channel ?? 'simulated';
    const channelUserId = data.channelUserId ?? id;

    this.db
      .prepare(
        `INSERT INTO conversations (
          id, property_id, channel, channel_user_id, customer_name, customer_phone,
          state, unread_count_staff, unread_count_customer, last_message_snippet,
          last_message_timestamp, ai_generation_version, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, 1, ?, ?);`
      )
      .run(
        id,
        data.propertyId,
        channel,
        channelUserId,
        data.customerName ?? null,
        data.customerPhone ?? null,
        state,
        null,
        now,
        now,
        now
      );

    return this.getConversationById(id)!;
  }

  public getConversationById(id: string): Conversation | null {
    const row = this.db.prepare('SELECT * FROM conversations WHERE id = ? LIMIT 1;').get(id) as any;
    if (!row) return null;
    return this.mapConversationRow(row);
  }

  public listConversations(filter: ConversationFilter): { items: Conversation[]; total: number } {
    const conditions: string[] = [];
    const params: any[] = [];

    if (filter.propertyId) {
      conditions.push('property_id = ?');
      params.push(filter.propertyId);
    }

    if (filter.state && filter.state !== 'ALL') {
      conditions.push('state = ?');
      params.push(filter.state);
    }

    if (filter.assignedStaffId) {
      conditions.push('assigned_staff_id = ?');
      params.push(filter.assignedStaffId);
    }

    if (filter.search && filter.search.trim().length > 0) {
      conditions.push('(customer_name LIKE ? OR customer_phone LIKE ? OR last_message_snippet LIKE ? OR id LIKE ?)');
      const pattern = `%${filter.search.trim()}%`;
      params.push(pattern, pattern, pattern, pattern);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // Total count query
    const countRow = this.db.prepare(`SELECT COUNT(*) as count FROM conversations ${whereClause};`).get(...params) as any;
    const total = countRow?.count ?? 0;

    // Items query with pagination
    const limit = filter.limit ?? 50;
    const offset = filter.offset ?? 0;
    const itemsQuery = `
      SELECT * FROM conversations
      ${whereClause}
      ORDER BY updated_at DESC
      LIMIT ? OFFSET ?;
    `;
    const rows = this.db.prepare(itemsQuery).all(...params, limit, offset) as any[];

    return {
      items: rows.map((r) => this.mapConversationRow(r)),
      total,
    };
  }

  public updateConversationState(
    id: string,
    newState: ConversationState,
    options?: {
      assignedStaffId?: string | null;
      assignedStaffName?: string | null;
      incrementAiVersion?: boolean;
    }
  ): Conversation | null {
    const now = new Date().toISOString();
    let query = `UPDATE conversations SET state = ?, updated_at = ?`;
    const params: any[] = [newState, now];

    if (options?.assignedStaffId !== undefined) {
      query += `, assigned_staff_id = ?`;
      params.push(options.assignedStaffId);
    }

    if (options?.assignedStaffName !== undefined) {
      query += `, assigned_staff_name = ?`;
      params.push(options.assignedStaffName);
    }

    if (options?.incrementAiVersion) {
      query += `, ai_generation_version = ai_generation_version + 1`;
    }

    query += ` WHERE id = ?;`;
    params.push(id);

    this.db.prepare(query).run(...params);
    return this.getConversationById(id);
  }

  public updateConversationSnippet(
    id: string,
    snippet: string,
    timestamp: string,
    incrementStaffUnread: boolean = false,
    incrementCustomerUnread: boolean = false
  ): void {
    let query = `UPDATE conversations SET last_message_snippet = ?, last_message_timestamp = ?, updated_at = ?`;
    const params: any[] = [snippet.slice(0, 150), timestamp, timestamp];

    if (incrementStaffUnread) {
      query += `, unread_count_staff = unread_count_staff + 1`;
    }
    if (incrementCustomerUnread) {
      query += `, unread_count_customer = unread_count_customer + 1`;
    }

    query += ` WHERE id = ?;`;
    params.push(id);

    this.db.prepare(query).run(...params);
  }

  public resetStaffUnread(id: string): void {
    this.db.prepare('UPDATE conversations SET unread_count_staff = 0 WHERE id = ?;').run(id);
  }

  public resetCustomerUnread(id: string): void {
    this.db.prepare('UPDATE conversations SET unread_count_customer = 0 WHERE id = ?;').run(id);
  }

  // --------------------------------------------------------------------------
  // Messages
  // --------------------------------------------------------------------------

  public addMessage(message: Omit<Message, 'id' | 'createdAt'> & { id?: string; createdAt?: string }): Message {
    const id = message.id ?? randomUUID();
    const createdAt = message.createdAt ?? new Date().toISOString();
    const metadataJson = message.metadata ? JSON.stringify(message.metadata) : null;
    const clientMessageId = message.metadata?.clientMessageId ?? null;

    this.db
      .prepare(
        `INSERT INTO messages (id, conversation_id, sender_type, sender_id, sender_name, content, metadata_json, client_message_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);`
      )
      .run(
        id,
        message.conversationId,
        message.senderType,
        message.senderId ?? null,
        message.senderName ?? null,
        message.content,
        metadataJson,
        clientMessageId,
        createdAt
      );

    return {
      id,
      conversationId: message.conversationId,
      senderType: message.senderType,
      senderId: message.senderId,
      senderName: message.senderName,
      content: message.content,
      metadata: message.metadata,
      createdAt,
    };
  }

  public getMessagesByConversationId(conversationId: string, limit: number = 100): Message[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC LIMIT ?;`
      )
      .all(conversationId, limit) as any[];

    return rows.map((r) => ({
      id: r.id,
      conversationId: r.conversation_id,
      senderType: r.sender_type,
      senderId: r.sender_id ?? undefined,
      senderName: r.sender_name ?? undefined,
      content: r.content,
      metadata: r.metadata_json ? JSON.parse(r.metadata_json) : undefined,
      createdAt: r.created_at,
    }));
  }

  // --------------------------------------------------------------------------
  // Internal Notes
  // --------------------------------------------------------------------------

  public addInternalNote(note: Omit<InternalNote, 'id' | 'createdAt'>): InternalNote {
    const id = randomUUID();
    const createdAt = new Date().toISOString();

    this.db
      .prepare(
        `INSERT INTO internal_notes (id, conversation_id, staff_id, staff_name, content, created_at)
         VALUES (?, ?, ?, ?, ?, ?);`
      )
      .run(id, note.conversationId, note.staffId, note.staffName, note.content, createdAt);

    return {
      id,
      conversationId: note.conversationId,
      staffId: note.staffId,
      staffName: note.staffName,
      content: note.content,
      createdAt,
    };
  }

  public getInternalNotesByConversationId(conversationId: string): InternalNote[] {
    const rows = this.db
      .prepare(`SELECT * FROM internal_notes WHERE conversation_id = ? ORDER BY created_at ASC;`)
      .all(conversationId) as any[];

    return rows.map((r) => ({
      id: r.id,
      conversationId: r.conversation_id,
      staffId: r.staff_id,
      staffName: r.staff_name,
      content: r.content,
      createdAt: r.created_at,
    }));
  }

  // --------------------------------------------------------------------------
  // Audit Logs
  // --------------------------------------------------------------------------

  public addAuditLog(log: Omit<AuditLog, 'id' | 'timestamp'>): AuditLog {
    const id = randomUUID();
    const timestamp = new Date().toISOString();
    const detailsJson = log.details ? JSON.stringify(log.details) : null;

    this.db
      .prepare(
        `INSERT INTO audit_logs (id, conversation_id, property_id, staff_id, staff_name, action, details_json, timestamp)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?);`
      )
      .run(
        id,
        log.conversationId ?? null,
        log.propertyId ?? null,
        log.staffId,
        log.staffName,
        log.action,
        detailsJson,
        timestamp
      );

    return {
      id,
      conversationId: log.conversationId,
      propertyId: log.propertyId,
      staffId: log.staffId,
      staffName: log.staffName,
      action: log.action,
      details: log.details,
      timestamp,
    };
  }

  public getAuditLogs(filter?: {
    conversationId?: string;
    propertyId?: PropertyId;
    limit?: number;
  }): AuditLog[] {
    const conditions: string[] = [];
    const params: any[] = [];

    if (filter?.conversationId) {
      conditions.push('conversation_id = ?');
      params.push(filter.conversationId);
    }
    if (filter?.propertyId) {
      conditions.push('property_id = ?');
      params.push(filter.propertyId);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = filter?.limit ?? 100;

    const rows = this.db
      .prepare(`SELECT * FROM audit_logs ${whereClause} ORDER BY timestamp DESC LIMIT ?;`)
      .all(...params, limit) as any[];

    return rows.map((r) => ({
      id: r.id,
      conversationId: r.conversation_id ?? undefined,
      propertyId: r.property_id ?? undefined,
      staffId: r.staff_id,
      staffName: r.staff_name,
      action: r.action as AuditAction,
      details: r.details_json ? JSON.parse(r.details_json) : undefined,
      timestamp: r.timestamp,
    }));
  }

  // --------------------------------------------------------------------------
  // Idempotency Keys (Duplicate Prevention)
  // --------------------------------------------------------------------------

  /**
   * Checks if an idempotency key exists. If not, stores it with an expiry timestamp.
   * Returns true if newly stored (allowed); false if already used (duplicate).
   */
  public checkAndSetIdempotencyKey(key: string, ttlSeconds: number = 300): boolean {
    const now = Math.floor(Date.now() / 1000);
    const expiresAt = now + ttlSeconds;

    // Prune expired keys periodically
    this.db.prepare('DELETE FROM idempotency_keys WHERE expires_at < ?;').run(now);

    try {
      this.db
        .prepare('INSERT INTO idempotency_keys (key, expires_at) VALUES (?, ?);')
        .run(key, expiresAt);
      return true;
    } catch {
      // Key collision
      return false;
    }
  }

  // --------------------------------------------------------------------------
  // Private Helper
  // --------------------------------------------------------------------------

  private mapConversationRow(r: any): Conversation {
    return {
      id: r.id,
      propertyId: r.property_id,
      channel: r.channel,
      channelUserId: r.channel_user_id,
      customerName: r.customer_name ?? undefined,
      customerPhone: r.customer_phone ?? undefined,
      state: r.state,
      assignedStaffId: r.assigned_staff_id ?? undefined,
      assignedStaffName: r.assigned_staff_name ?? undefined,
      unreadCountStaff: r.unread_count_staff ?? 0,
      unreadCountCustomer: r.unread_count_customer ?? 0,
      lastMessageSnippet: r.last_message_snippet ?? undefined,
      lastMessageTimestamp: r.last_message_timestamp,
      aiGenerationVersion: r.ai_generation_version ?? 1,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }
}
