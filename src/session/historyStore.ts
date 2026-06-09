import type { ExtensionContext } from "vscode";

/**
 * Serializable token usage snapshot.
 */
export interface HistoryTokenUsage {
  input: number;
  output: number;
  total: number;
}

/**
 * Serializable session history entry stored in globalState.
 * All dates are ISO 8601 strings for JSON compatibility.
 */
export interface HistoryEntry {
  sessionId: string;
  agentId: string;
  title: string;
  cwd: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  tokenUsage: HistoryTokenUsage;
  lastMessage?: string; // truncated to 200 chars
}

const STORAGE_KEY = "acp.sessionHistory";
const MAX_ENTRIES = 200;
const MAX_LAST_MESSAGE_LENGTH = 200;

function truncate(text: string, max: number): string {
  return text.length > max ? text.slice(0, max) : text;
}

/**
 * Persistent session history backed by {@link ExtensionContext.globalState}.
 *
 * - Stores metadata only (no full message bodies).
 * - Newest entries first.
 * - FIFO eviction once the cap (200) is exceeded.
 * - All dates are ISO strings so entries are fully JSON-serialisable.
 */
export class SessionHistoryStore {
  private readonly context: ExtensionContext;

  constructor(context: ExtensionContext) {
    this.context = context;
  }

  /**
   * Append a history entry (prepended as newest).
   * `lastMessage` is truncated to 200 characters.
   * Evicts the oldest entry when the store exceeds 200 items.
   */
  async addEntry(entry: HistoryEntry): Promise<void> {
    const entries = this.load();

    const sanitized: HistoryEntry = {
      ...entry,
      lastMessage: entry.lastMessage
        ? truncate(entry.lastMessage, MAX_LAST_MESSAGE_LENGTH)
        : undefined,
    };

    entries.unshift(sanitized);

    if (entries.length > MAX_ENTRIES) {
      entries.length = MAX_ENTRIES; // FIFO: drop from the tail (oldest)
    }

    await this.save(entries);
  }

  /** Return every history entry, newest first. */
  getEntries(): HistoryEntry[] {
    return this.load();
  }

  /**
   * Case-insensitive search across `title`, `lastMessage`, `agentId`,
   * and `sessionId`. Results are newest-first.
   */
  search(query: string): HistoryEntry[] {
    const q = query.toLowerCase();
    return this.load().filter(
      (e) =>
        e.title.toLowerCase().includes(q) ||
        (e.lastMessage?.toLowerCase().includes(q) ?? false) ||
        e.agentId.toLowerCase().includes(q) ||
        e.sessionId.toLowerCase().includes(q),
    );
  }

  /** Return entries for a specific agent, newest first. */
  getEntriesByAgent(agentId: string): HistoryEntry[] {
    return this.load().filter((e) => e.agentId === agentId);
  }

  /** Look up a single entry by session id. */
  getEntry(sessionId: string): HistoryEntry | undefined {
    return this.load().find((e) => e.sessionId === sessionId);
  }

  /**
   * Upsert a history entry by sessionId.
   * If an entry with the same sessionId exists it is replaced; otherwise prepended.
   */
  async upsertEntry(entry: HistoryEntry): Promise<void> {
    const entries = this.load();
    const idx = entries.findIndex((e) => e.sessionId === entry.sessionId);
    const sanitized: HistoryEntry = {
      ...entry,
      lastMessage: entry.lastMessage
        ? truncate(entry.lastMessage, MAX_LAST_MESSAGE_LENGTH)
        : undefined,
    };
    if (idx >= 0) {
      entries[idx] = sanitized;
    } else {
      entries.unshift(sanitized);
      if (entries.length > MAX_ENTRIES) {
        entries.length = MAX_ENTRIES;
      }
    }
    await this.save(entries);
  }

  /** Remove an entry by session id. */
  async removeEntry(sessionId: string): Promise<void> {
    const entries = this.load().filter((e) => e.sessionId !== sessionId);
    await this.save(entries);
  }

  /** Remove every entry. */
  async clear(): Promise<void> {
    await this.save([]);
  }

  /* ------------------------------------------------------------------ */
  /*  Private persistence helpers                                        */
  /* ------------------------------------------------------------------ */

  private load(): HistoryEntry[] {
    return this.context.globalState.get<HistoryEntry[]>(STORAGE_KEY, []);
  }

  private async save(entries: HistoryEntry[]): Promise<void> {
    await this.context.globalState.update(STORAGE_KEY, entries);
  }
}
