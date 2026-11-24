import { DatabaseSync } from 'node:sqlite';

export interface Migration {
  version: number;
  name: string;
  up: (db: DatabaseSync) => void;
}

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: '001_initial_staff_and_conversation_schema',
    up: (db: DatabaseSync) => {
      // 1. Staff users table
      db.exec(`
        CREATE TABLE IF NOT EXISTS staff_users (
          id TEXT PRIMARY KEY,
          username TEXT UNIQUE NOT NULL,
          full_name TEXT NOT NULL,
          role TEXT NOT NULL,
          property_id TEXT,
          password_hash TEXT NOT NULL,
          salt TEXT NOT NULL,
          is_active INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL
        );
      `);

      // 2. Conversations table
      db.exec(`
        CREATE TABLE IF NOT EXISTS conversations (
          id TEXT PRIMARY KEY,
          property_id TEXT NOT NULL,
          channel TEXT NOT NULL DEFAULT 'simulated',
          channel_user_id TEXT NOT NULL,
          customer_name TEXT,
          customer_phone TEXT,
          state TEXT NOT NULL DEFAULT 'AI_ACTIVE',
          assigned_staff_id TEXT,
          assigned_staff_name TEXT,
          unread_count_staff INTEGER NOT NULL DEFAULT 0,
          unread_count_customer INTEGER NOT NULL DEFAULT 0,
          last_message_snippet TEXT,
          last_message_timestamp TEXT NOT NULL,
          ai_generation_version INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_conversations_property_state ON conversations(property_id, state);
        CREATE INDEX IF NOT EXISTS idx_conversations_updated ON conversations(updated_at DESC);
      `);

      // 3. Messages table
      db.exec(`
        CREATE TABLE IF NOT EXISTS messages (
          id TEXT PRIMARY KEY,
          conversation_id TEXT NOT NULL,
          sender_type TEXT NOT NULL,
          sender_id TEXT,
          sender_name TEXT,
          content TEXT NOT NULL,
          metadata_json TEXT,
          client_message_id TEXT,
          created_at TEXT NOT NULL,
          FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, created_at ASC);
        CREATE INDEX IF NOT EXISTS idx_messages_client_id ON messages(client_message_id);
      `);

      // 4. Internal notes table
      db.exec(`
        CREATE TABLE IF NOT EXISTS internal_notes (
          id TEXT PRIMARY KEY,
          conversation_id TEXT NOT NULL,
          staff_id TEXT NOT NULL,
          staff_name TEXT NOT NULL,
          content TEXT NOT NULL,
          created_at TEXT NOT NULL,
          FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_notes_conversation ON internal_notes(conversation_id, created_at ASC);
      `);

      // 5. Audit logs table
      db.exec(`
        CREATE TABLE IF NOT EXISTS audit_logs (
          id TEXT PRIMARY KEY,
          conversation_id TEXT,
          property_id TEXT,
          staff_id TEXT NOT NULL,
          staff_name TEXT NOT NULL,
          action TEXT NOT NULL,
          details_json TEXT,
          timestamp TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_audit_conversation ON audit_logs(conversation_id, timestamp DESC);
        CREATE INDEX IF NOT EXISTS idx_audit_property ON audit_logs(property_id, timestamp DESC);
      `);

      // 6. Idempotency keys table
      db.exec(`
        CREATE TABLE IF NOT EXISTS idempotency_keys (
          key TEXT PRIMARY KEY,
          expires_at INTEGER NOT NULL
        );
      `);
    },
  },
];

export function runMigrations(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);

  const appliedRows = db.prepare('SELECT version FROM schema_migrations ORDER BY version ASC').all() as {
    version: number;
  }[];
  const appliedVersions = new Set(appliedRows.map((r) => r.version));

  for (const migration of MIGRATIONS) {
    if (!appliedVersions.has(migration.version)) {
      migration.up(db);
      db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?);').run(
        migration.version,
        migration.name,
        new Date().toISOString()
      );
    }
  }
}
