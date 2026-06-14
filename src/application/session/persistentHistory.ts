import * as path from "path";
import * as fs from "fs";
import { homedir } from "os";
import initSqlJs, { type Database } from "sql.js";
import type { SessionInfo, SessionStatus } from "./types";
import type { ChatMessage, TokenUsage } from "../../domain/models/chat";
import { SCHEMA_SQL } from "./schema";

// ============================================================================
// Log Entry types
// ============================================================================

export interface LogEntry {
  id?: number;
  source: string;
  traceId: string | null;
  sessionId: string | null;
  agentId: string | null;
  category: string;
  level: number;
  message: string;
  contextJson: string | null;
  timestamp: number;
}

export interface LogExportFilter {
  sessions?: string[] | null;
  since?: number | null;
  agentId?: string | null;
  source?: string | null;
}

export interface LogExportResult {
  sessions: PersistentSessionEntry[];
  logs: LogEntry[];
}

// ============================================================================
// Configuration
// ============================================================================

const DEFAULT_MAX_AGE_DAYS = 90;
const DEFAULT_MAX_SESSIONS = 1000;
const DEFAULT_MAX_MESSAGES_PER_SESSION = 10000;

export interface HistoryConfig {
  maxAgeDays: number;
  maxSessions: number;
  maxMessagesPerSession: number;
}

const DEFAULT_CONFIG: HistoryConfig = {
  maxAgeDays: DEFAULT_MAX_AGE_DAYS,
  maxSessions: DEFAULT_MAX_SESSIONS,
  maxMessagesPerSession: DEFAULT_MAX_MESSAGES_PER_SESSION,
};

// ============================================================================
// DB path helper
// ============================================================================

function getDbPath(storageUri?: string): string {
  if (storageUri) {
    const baseDir = storageUri;
    if (!fs.existsSync(baseDir)) {
      fs.mkdirSync(baseDir, { recursive: true });
    }
    return path.join(baseDir, "session_history.db");
  }
  const baseDir = path.join(homedir(), ".vscode", "acp-client");
  if (!fs.existsSync(baseDir)) {
    fs.mkdirSync(baseDir, { recursive: true });
  }
  return path.join(baseDir, "session_history.db");
}

// ============================================================================
// Public DTOs
// ============================================================================

export interface PersistentSessionEntry {
  sessionId: string;
  agentId: string;
  title: string;
  cwd: string;
  model: string | null;
  mode: string | null;
  status: SessionStatus;
  workspaceName: string | null;
  createdAt: string;
  messageCount: number;
  tokenUsage: TokenUsage;
  contextWindowMax: number | null;
  isArchived: boolean;
}

export interface SessionMessages {
  messages: ChatMessage[];
  tokenUsage: TokenUsage;
}

export interface SearchResult {
  session: PersistentSessionEntry;
  matchedMessages: ChatMessage[];
}

// ============================================================================
// Row types (mirrors schema columns)
// ============================================================================

interface SessionRow {
  session_id: string;
  agent_id: string;
  title: string;
  cwd: string;
  model: string | null;
  mode: string | null;
  status: string;
  workspace_name: string | null;
  created_at: string;
  message_count: number;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  context_window_max: number | null;
  is_archived: number;
}

interface MessageRow {
  id: string;
  session_id: string;
  role: string;
  content: string;
  timestamp: number;
  tool_calls_json: string | null;
  attachments_json: string | null;
  inline_file_paths: string | null;
  session_cwd: string | null;
}

// ============================================================================
// Persistent History Store
// ============================================================================

export class PersistentHistoryStore {
  private db: Database | null = null;
  private config: HistoryConfig;
  private storageUri: string | undefined;
  private writeQueue: Map<string, SessionInfo> = new Map();
  private writeTimeout: ReturnType<typeof setTimeout> | null = null;
  private readonly WRITE_DEBOUNCE_MS = 1000;
  private dbPath: string = "";

  constructor(config: Partial<HistoryConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // ========================================================================
  // Lifecycle
  // ========================================================================

  async initialize(storageUri?: string): Promise<void> {
    const SQL = await initSqlJs();
    this.dbPath = getDbPath(storageUri);

    if (fs.existsSync(this.dbPath)) {
      const buffer = fs.readFileSync(this.dbPath);
      this.db = new SQL.Database(buffer);
    } else {
      this.db = new SQL.Database();
    }

    this.db.run(SCHEMA_SQL);
    this.persist();
  }

  dispose(): void {
    this.flushWriteQueue();
    this.persist();
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }

  private persist(): void {
    if (!this.db) return;
    const data = this.db.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(this.dbPath, buffer);
  }

  // ========================================================================
  // Session CRUD
  // ========================================================================

  saveSession(session: SessionInfo): void {
    this.writeQueue.set(session.sessionId, session);
    this.scheduleWrite();
  }

  private scheduleWrite(): void {
    if (this.writeTimeout) return;
    this.writeTimeout = setTimeout(() => {
      this.flushWriteQueue();
    }, this.WRITE_DEBOUNCE_MS);
  }

  private flushWriteQueue(): void {
    if (this.writeTimeout) {
      clearTimeout(this.writeTimeout);
      this.writeTimeout = null;
    }
    if (this.writeQueue.size === 0) return;

    const entries = Array.from(this.writeQueue.values());
    this.writeQueue.clear();

    for (const session of entries) {
      this.upsertSession(session);
    }
    this.persist();
  }

  private upsertSession(info: SessionInfo): void {
    if (!this.db) return;

    const workspaceName = this.extractWorkspaceName(info.cwd);
    const now = new Date().toISOString();

    // Check if session exists
    const existing = this.db.exec(
      "SELECT session_id FROM sessions WHERE session_id = ?",
      [info.sessionId]
    );

    if (existing.length > 0 && existing[0].values.length > 0) {
      // Update
      this.db.run(
        `UPDATE sessions SET
          title = ?, status = ?, message_count = ?,
          input_tokens = ?, output_tokens = ?, total_tokens = ?,
          context_window_max = ?
         WHERE session_id = ?`,
        [
          info.title,
          info.status,
          info.messages.length,
          info.tokenUsage.input,
          info.tokenUsage.output,
          info.tokenUsage.total,
          info.contextWindowMax ?? null,
          info.sessionId,
        ]
      );
    } else {
      // Insert
      this.db.run(
        `INSERT INTO sessions (
          session_id, agent_id, title, cwd, model, mode, status,
          workspace_name, created_at, message_count,
          input_tokens, output_tokens, total_tokens, context_window_max, is_archived
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
        [
          info.sessionId,
          info.agentId,
          info.title,
          info.cwd,
          info.model ?? null,
          info.mode ?? null,
          info.status,
          workspaceName,
          info.createdAt.toISOString(),
          info.messages.length,
          info.tokenUsage.input,
          info.tokenUsage.output,
          info.tokenUsage.total,
          info.contextWindowMax ?? null,
        ]
      );
    }
  }

  async saveMessages(sessionId: string, msgs: ChatMessage[]): Promise<void> {
    if (!this.db || msgs.length === 0) return;

    for (const msg of msgs) {
      // Skip if already exists
      const existing = this.db.exec("SELECT id FROM messages WHERE id = ?", [
        msg.id,
      ]);
      if (existing.length > 0 && existing[0].values.length > 0) continue;

      this.db.run(
        `INSERT INTO messages (
          id, session_id, role, content, timestamp,
          tool_calls_json, attachments_json, inline_file_paths, session_cwd
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          msg.id,
          sessionId,
          msg.role,
          msg.content,
          msg.timestamp,
          (msg as any).toolCallsJson ?? null,
          (msg as any).attachmentsJson ?? null,
          msg.inlineFilePaths ? JSON.stringify(msg.inlineFilePaths) : null,
          msg.sessionCwd ?? null,
        ]
      );
    }

    await this.updateMessageCount(sessionId);
    this.persist();
  }

  private async updateMessageCount(sessionId: string): Promise<void> {
    if (!this.db) return;
    const result = this.db.exec(
      "SELECT COUNT(*) as cnt FROM messages WHERE session_id = ?",
      [sessionId]
    );
    const count = (result[0]?.values[0]?.[0] as number) ?? 0;
    this.db.run("UPDATE sessions SET message_count = ? WHERE session_id = ?", [
      count,
      sessionId,
    ]);
  }

  getSession(sessionId: string): PersistentSessionEntry | undefined {
    if (!this.db) return undefined;
    const result = this.db.exec("SELECT * FROM sessions WHERE session_id = ?", [
      sessionId,
    ]);
    if (result.length === 0 || result[0].values.length === 0) return undefined;
    return this.rowToEntry(this.parseRow<SessionRow>(result[0]));
  }

  getAllSessions(): PersistentSessionEntry[] {
    if (!this.db) return [];
    const result = this.db.exec(
      "SELECT * FROM sessions WHERE is_archived = 0 ORDER BY created_at DESC"
    );
    return this.parseRows<SessionRow>(result[0]).map((r) => this.rowToEntry(r));
  }

  getSessionsByAgent(agentId: string): PersistentSessionEntry[] {
    if (!this.db) return [];
    const result = this.db.exec(
      "SELECT * FROM sessions WHERE agent_id = ? AND is_archived = 0 ORDER BY created_at DESC",
      [agentId]
    );
    return this.parseRows<SessionRow>(result[0]).map((r) => this.rowToEntry(r));
  }

  getSessionsByWorkspace(workspacePath: string): PersistentSessionEntry[] {
    if (!this.db) return [];
    const result = this.db.exec(
      "SELECT * FROM sessions WHERE cwd = ? AND is_archived = 0 ORDER BY created_at DESC",
      [workspacePath]
    );
    return this.parseRows<SessionRow>(result[0]).map((r) => this.rowToEntry(r));
  }

  // ========================================================================
  // Message Retrieval
  // ========================================================================

  getSessionMessages(sessionId: string): SessionMessages {
    if (!this.db)
      return { messages: [], tokenUsage: { input: 0, output: 0, total: 0 } };

    const result = this.db.exec(
      "SELECT * FROM messages WHERE session_id = ? ORDER BY timestamp ASC",
      [sessionId]
    );
    const msgs = this.parseRows<MessageRow>(result[0]).map((m) =>
      this.rowToMessage(m)
    );

    const session = this.getSession(sessionId);
    return {
      messages: msgs,
      tokenUsage: session?.tokenUsage ?? { input: 0, output: 0, total: 0 },
    };
  }

  // ========================================================================
  // Search
  // ========================================================================

  searchSessions(query: string): PersistentSessionEntry[] {
    if (!this.db) return [];
    const pattern = `%${query}%`;
    const result = this.db.exec(
      `SELECT * FROM sessions WHERE is_archived = 0 AND (
        title LIKE ? OR agent_id LIKE ? OR session_id LIKE ? OR cwd LIKE ?
      ) ORDER BY created_at DESC`,
      [pattern, pattern, pattern, pattern]
    );
    return this.parseRows<SessionRow>(result[0]).map((r) => this.rowToEntry(r));
  }

  searchMessages(sessionId: string, query: string): ChatMessage[] {
    if (!this.db) return [];
    const pattern = `%${query}%`;
    const result = this.db.exec(
      "SELECT * FROM messages WHERE session_id = ? AND content LIKE ? ORDER BY timestamp DESC",
      [sessionId, pattern]
    );
    return this.parseRows<MessageRow>(result[0]).map((m) =>
      this.rowToMessage(m)
    );
  }

  // ========================================================================
  // Deletion & Cleanup
  // ========================================================================

  async deleteSession(sessionId: string): Promise<void> {
    if (!this.db) return;
    this.db.run("DELETE FROM messages WHERE session_id = ?", [sessionId]);
    this.db.run("DELETE FROM sessions WHERE session_id = ?", [sessionId]);
    this.persist();
  }

  async archiveSession(sessionId: string): Promise<void> {
    if (!this.db) return;
    this.db.run("UPDATE sessions SET is_archived = 1 WHERE session_id = ?", [
      sessionId,
    ]);
    this.persist();
  }

  async unarchiveSession(sessionId: string): Promise<void> {
    if (!this.db) return;
    this.db.run("UPDATE sessions SET is_archived = 0 WHERE session_id = ?", [
      sessionId,
    ]);
    this.persist();
  }

  async cleanupExpiredSessions(
    maxAgeDays: number = this.config.maxAgeDays
  ): Promise<number> {
    if (!this.db) return 0;
    const cutoff = new Date(
      Date.now() - maxAgeDays * 24 * 60 * 60 * 1000
    ).toISOString();

    // Get count before deletion
    const before = this.db.exec(
      "SELECT COUNT(*) as cnt FROM sessions WHERE is_archived = 0 AND created_at < ?",
      [cutoff]
    );
    const count = (before[0]?.values[0]?.[0] as number) ?? 0;

    this.db.run(
      "DELETE FROM sessions WHERE is_archived = 0 AND created_at < ?",
      [cutoff]
    );
    this.persist();
    return count;
  }

  async enforceMaxSessions(): Promise<number> {
    if (!this.db) return 0;
    const countResult = this.db.exec(
      "SELECT COUNT(*) as cnt FROM sessions WHERE is_archived = 0"
    );
    const count = (countResult[0]?.values[0]?.[0] as number) ?? 0;
    if (count <= this.config.maxSessions) return 0;

    const excess = count - this.config.maxSessions;
    const oldSessions = this.db.exec(
      "SELECT session_id FROM sessions WHERE is_archived = 0 ORDER BY created_at ASC LIMIT ?",
      [excess]
    );

    if (oldSessions.length === 0 || oldSessions[0].values.length === 0)
      return 0;

    const ids = oldSessions[0].values.map((row) => row[0] as string);
    const placeholders = ids.map(() => "?").join(",");
    this.db.run(
      `DELETE FROM sessions WHERE session_id IN (${placeholders})`,
      ids
    );
    this.persist();
    return ids.length;
  }

  // ========================================================================
  // Log Entry CRUD
  // ========================================================================

  saveLogEntry(entry: Omit<LogEntry, "id">): void {
    if (!this.db) return;
    this.db.run(
      `INSERT INTO log_entries (
        source, trace_id, session_id, agent_id,
        category, level, message, context_json, timestamp
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        entry.source,
        entry.traceId,
        entry.sessionId,
        entry.agentId,
        entry.category,
        entry.level,
        entry.message,
        entry.contextJson,
        entry.timestamp,
      ]
    );
    // Persist periodically — callers should batch or debounce
    this.persist();
  }

  getLogs(filter?: LogExportFilter): LogEntry[] {
    if (!this.db) return [];

    const conditions: string[] = [];
    const params: (string | number)[] = [];

    if (filter?.sessions && filter.sessions.length > 0) {
      const placeholders = filter.sessions.map(() => "?").join(",");
      conditions.push(`session_id IN (${placeholders})`);
      params.push(...filter.sessions);
    }
    if (filter?.since !== undefined && filter.since !== null) {
      conditions.push("timestamp >= ?");
      params.push(filter.since);
    }
    if (filter?.agentId !== undefined && filter.agentId !== null) {
      conditions.push("agent_id = ?");
      params.push(filter.agentId);
    }
    if (filter?.source !== undefined && filter.source !== null) {
      conditions.push("source = ?");
      params.push(filter.source);
    }

    const where =
      conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const result = this.db.exec(
      `SELECT * FROM log_entries ${where} ORDER BY timestamp ASC`,
      params
    );

    if (result.length === 0) return [];
    return result[0].values.map((row) => ({
      id: row[0] as number,
      source: row[1] as string,
      traceId: row[2] as string | null,
      sessionId: row[3] as string | null,
      agentId: row[4] as string | null,
      category: row[5] as string,
      level: row[6] as number,
      message: row[7] as string,
      contextJson: row[8] as string | null,
      timestamp: row[9] as number,
    }));
  }

  cleanupExpiredLogs(retentionDays: number): number {
    if (!this.db) return 0;
    const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;

    const before = this.db.exec(
      "SELECT COUNT(*) as cnt FROM log_entries WHERE timestamp < ?",
      [cutoff]
    );
    const count = (before[0]?.values[0]?.[0] as number) ?? 0;

    this.db.run("DELETE FROM log_entries WHERE timestamp < ?", [cutoff]);
    this.persist();
    return count;
  }

  // ========================================================================
  // Log Entry Deletion
  // ========================================================================

  clearLogs(options: {
    olderThan?: number | null;
    agentId?: string | null;
    sessionId?: string | null;
  }): { deletedCount: number } {
    if (!this.db) return { deletedCount: 0 };

    const conditions: string[] = [];
    const params: (string | number)[] = [];

    if (options.olderThan !== undefined && options.olderThan !== null) {
      conditions.push("timestamp < ?");
      params.push(options.olderThan);
    }
    if (options.agentId !== undefined && options.agentId !== null) {
      conditions.push("agent_id = ?");
      params.push(options.agentId);
    }
    if (options.sessionId !== undefined && options.sessionId !== null) {
      conditions.push("session_id = ?");
      params.push(options.sessionId);
    }

    const where =
      conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const before = this.db.exec(
      `SELECT COUNT(*) as cnt FROM log_entries ${where}`,
      params
    );
    const count = (before[0]?.values[0]?.[0] as number) ?? 0;

    this.db.run(`DELETE FROM log_entries ${where}`, params);
    this.persist();

    return { deletedCount: count };
  }

  countLogs(options: {
    olderThan?: number | null;
    agentId?: string | null;
    sessionId?: string | null;
  }): number {
    if (!this.db) return 0;

    const conditions: string[] = [];
    const params: (string | number)[] = [];

    if (options.olderThan !== undefined && options.olderThan !== null) {
      conditions.push("timestamp < ?");
      params.push(options.olderThan);
    }
    if (options.agentId !== undefined && options.agentId !== null) {
      conditions.push("agent_id = ?");
      params.push(options.agentId);
    }
    if (options.sessionId !== undefined && options.sessionId !== null) {
      conditions.push("session_id = ?");
      params.push(options.sessionId);
    }

    const where =
      conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const result = this.db.exec(
      `SELECT COUNT(*) as cnt FROM log_entries ${where}`,
      params
    );
    return (result[0]?.values[0]?.[0] as number) ?? 0;
  }

  // ========================================================================
  // Statistics
  // ========================================================================

  getStats(): {
    totalSessions: number;
    totalMessages: number;
    oldestSession: string | null;
  } {
    if (!this.db)
      return { totalSessions: 0, totalMessages: 0, oldestSession: null };

    const sessionCount = this.db.exec(
      "SELECT COUNT(*) as cnt FROM sessions WHERE is_archived = 0"
    );
    const messageCount = this.db.exec("SELECT COUNT(*) as cnt FROM messages");
    const oldest = this.db.exec(
      "SELECT created_at FROM sessions WHERE is_archived = 0 ORDER BY created_at ASC LIMIT 1"
    );

    return {
      totalSessions: (sessionCount[0]?.values[0]?.[0] as number) ?? 0,
      totalMessages: (messageCount[0]?.values[0]?.[0] as number) ?? 0,
      oldestSession: (oldest[0]?.values[0]?.[0] as string) ?? null,
    };
  }

  // ========================================================================
  // Row Mappers
  // ========================================================================

  private parseRow<T>(result: { columns: string[]; values: any[][] }): T {
    const row: any = {};
    result.columns.forEach((col, i) => {
      row[col] = result.values[0][i];
    });
    return row as T;
  }

  private parseRows<T>(result: { columns: string[]; values: any[][] }): T[] {
    if (!result) return [];
    return result.values.map((row) => {
      const obj: any = {};
      result.columns.forEach((col, i) => {
        obj[col] = row[i];
      });
      return obj as T;
    });
  }

  private rowToEntry(row: SessionRow): PersistentSessionEntry {
    return {
      sessionId: row.session_id,
      agentId: row.agent_id,
      title: row.title,
      cwd: row.cwd,
      model: row.model,
      mode: row.mode,
      status: row.status as SessionStatus,
      workspaceName: row.workspace_name,
      createdAt: row.created_at,
      messageCount: row.message_count,
      tokenUsage: {
        input: row.input_tokens,
        output: row.output_tokens,
        total: row.total_tokens,
      },
      contextWindowMax: row.context_window_max,
      isArchived: row.is_archived === 1,
    };
  }

  private rowToMessage(row: MessageRow): ChatMessage {
    return {
      id: row.id,
      role: row.role as ChatMessage["role"],
      content: row.content,
      timestamp: row.timestamp,
      toolCallsJson: row.tool_calls_json ?? undefined,
      attachmentsJson: row.attachments_json ?? undefined,
      inlineFilePaths: row.inline_file_paths
        ? JSON.parse(row.inline_file_paths)
        : undefined,
      sessionCwd: row.session_cwd ?? undefined,
    } as ChatMessage;
  }

  private extractWorkspaceName(cwd: string): string | null {
    if (!cwd) return null;
    const parts = cwd.split("/");
    return parts[parts.length - 1] || null;
  }
}
