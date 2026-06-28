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

CREATE TABLE IF NOT EXISTS log_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL,
  trace_id TEXT,
  session_id TEXT,
  agent_id TEXT,
  category TEXT NOT NULL,
  level INTEGER NOT NULL,
  message TEXT NOT NULL,
  context_json TEXT,
  timestamp INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_agent ON sessions(agent_id);
CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_log_entries_source ON log_entries(source, timestamp);
CREATE INDEX IF NOT EXISTS idx_log_entries_trace ON log_entries(trace_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_log_entries_session ON log_entries(session_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_log_entries_agent ON log_entries(agent_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_log_entries_category ON log_entries(category, timestamp);
`;
