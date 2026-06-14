// ============================================================================
// SQL schema definitions for sql.js (WASM SQLite)
// ============================================================================

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS sessions (
  session_id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  cwd TEXT NOT NULL DEFAULT '',
  model TEXT,
  mode TEXT,
  status TEXT NOT NULL DEFAULT 'idle',
  workspace_name TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT,
  message_count INTEGER DEFAULT 0,
  input_tokens INTEGER DEFAULT 0,
  output_tokens INTEGER DEFAULT 0,
  total_tokens INTEGER DEFAULT 0,
  context_window_max INTEGER,
  is_archived INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  timestamp INTEGER NOT NULL,
  tool_calls_json TEXT,
  attachments_json TEXT,
  inline_file_paths TEXT,
  session_cwd TEXT,
  FOREIGN KEY (session_id) REFERENCES sessions(session_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_sessions_agent ON sessions(agent_id);
CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, timestamp);
`;
