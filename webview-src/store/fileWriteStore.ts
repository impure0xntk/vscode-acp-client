import { create } from "zustand";
import { sessionKeyOf } from "./sessionStore";
import { getLogger } from "../lib/logger";

const log = getLogger("webview.store.fileWrite");

/**
 * ACP fs/write_text_file events, scoped per session.
 *
 * - extension host から session/webviewFileWrite が到達 → addWrite
 * - session/turnActive(active=false) → clearSession (turn 終了 = 次の turn に備えてクリア)
 * - grouping.ts がこの store にアクセスして per-step FileEditSummary を生成
 *
 * Each write carries a sequential `seq` number (monotonically increasing
 * across the entire store).  This allows grouping.ts to partition writes
 * by step boundaries using `writeSeq` stamped on ChatDisplayItems.
 */

export interface FileWriteRecord {
  path: string;
  content: string;
  /** Monotonically increasing sequence number across all sessions */
  seq: number;
}

interface FileWriteStoreState {
  writes: Record<string, FileWriteRecord[]>;
  /** Next sequence number to assign */
  nextSeq: number;

  addWrite: (agentId: string, sessionId: string, path: string, content: string) => void;
  clearSession: (agentId: string, sessionId: string) => void;
  getWritesForSession: (agentId: string, sessionId: string) => FileWriteRecord[];
  /** Return the current sequence counter (number of writes so far) */
  currentSeq: () => number;
}

export const useFileWriteStore = create<FileWriteStoreState>((set, get) => ({
  writes: {},
  nextSeq: 0,

  addWrite: (agentId, sessionId, path, content) => {
    const key = sessionKeyOf(agentId, sessionId);
    set((s) => {
      const existing = s.writes[key] ?? [];
      const seq = s.nextSeq;
      log.debug("addWrite", { key, path, contentLen: content.length, seq, totalWrites: existing.length + 1 });
      return {
        nextSeq: seq + 1,
        writes: {
          ...s.writes,
          [key]: [...existing, { path, content, seq }],
        },
      };
    });
  },

  clearSession: (agentId, sessionId) => {
    const key = sessionKeyOf(agentId, sessionId);
    set((s) => {
      const next = { ...s.writes };
      delete next[key];
      return { writes: next };
    });
  },

  getWritesForSession: (agentId, sessionId) => {
    const key = sessionKeyOf(agentId, sessionId);
    const writes = get().writes[key] ?? [];
    log.debug("getWritesForSession", { key, count: writes.length, seqs: writes.map((w) => w.seq) });
    return writes;
  },

  currentSeq: () => get().nextSeq,
}));
