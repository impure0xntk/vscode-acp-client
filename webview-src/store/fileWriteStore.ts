import { create } from "zustand";
import { sessionKeyOf } from "./sessionStore";
import { getLogger } from "../lib/logger";

const log = getLogger("webview.store.fileWrite");

/**
 * ACP fs/write_text_file events, scoped per session.
 */

export interface FileWriteRecord {
  path: string;
  content: string;
  /** Original content before this write (for revert/diff) */
  originalContent: string | null;
  /** Monotonically increasing sequence number across all sessions */
  seq: number;
  /** SHA-256 hash of the content after writing (for stale-file detection) */
  contentHash: string;
}

export interface FileWriteStoreState {
  writes: Record<string, FileWriteRecord[]>;
  /** Next sequence number to assign */
  nextSeq: number;

  addWrite: (
    agentId: string,
    sessionId: string,
    path: string,
    content: string,
    originalContent?: string | null,
    contentHash?: string
  ) => void;
  clearSession: (agentId: string, sessionId: string) => void;
  getWritesForSession: (
    agentId: string,
    sessionId: string
  ) => FileWriteRecord[];
  getOriginalContent: (
    agentId: string,
    sessionId: string,
    path: string
  ) => string | null;
  getLastWriteHash: (
    agentId: string,
    sessionId: string,
    path: string
  ) => string | null;
  currentSeq: () => number;
}

export const useFileWriteStore = create<FileWriteStoreState>((set, get) => ({
  writes: {},
  nextSeq: 0,

  addWrite: (
    agentId,
    sessionId,
    path,
    content,
    originalContent,
    contentHash
  ) => {
    const key = sessionKeyOf(agentId, sessionId);
    set((s) => {
      const existing = s.writes[key] ?? [];
      const seq = s.nextSeq;
      log.debug("addWrite", {
        key,
        path,
        contentLen: content.length,
        seq,
        totalWrites: existing.length + 1,
      });
      return {
        nextSeq: seq + 1,
        writes: {
          ...s.writes,
          [key]: [
            ...existing,
            {
              path,
              content,
              originalContent: originalContent ?? null,
              seq,
              contentHash: contentHash ?? "",
            },
          ],
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
    log.debug("getWritesForSession", {
      key,
      count: writes.length,
      seqs: writes.map((w) => w.seq),
    });
    return writes;
  },

  getOriginalContent: (
    agentId: string,
    sessionId: string,
    path: string
  ): string | null => {
    const key = sessionKeyOf(agentId, sessionId);
    const writes = get().writes[key] ?? [];
    for (const w of writes) {
      if (w.path === path && w.originalContent != null) {
        return w.originalContent;
      }
    }
    return null;
  },

  getLastWriteHash: (
    agentId: string,
    sessionId: string,
    path: string
  ): string | null => {
    const key = sessionKeyOf(agentId, sessionId);
    const writes = get().writes[key] ?? [];
    let lastHash: string | null = null;
    for (const w of writes) {
      if (w.path === path && w.contentHash) {
        lastHash = w.contentHash;
      }
    }
    return lastHash;
  },

  currentSeq: () => get().nextSeq,
}));
