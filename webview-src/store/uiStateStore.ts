import { create } from "zustand";
import { produce } from "immer";
import type { SessionOverviewFilter, SessionOverviewState } from "../types";
import { getLogger } from "../lib/logger";

const log = getLogger("webview.store.ui");

// ── Per-session UI state ────────────────────────────────────────────────────

export interface ScrollState {
  scrollTop: number;
  lastSeenMessageId: string | null;
  streamingActive: boolean;
  streamingAction: string | null;
  streamingStartedAt: string | null;
}

// ── Store shape ──────────────────────────────────────────────────────────────

interface UiStateStore {
  // Per-session UI state (from sessionUiStateStore)
  scrollStates: Record<string, ScrollState>;

  // Overview panel chrome (from sessionStore)
  overviewVisible: boolean;
  overviewWidth: number;
  overviewPosition: "right" | "left";
  overviewFilter: SessionOverviewFilter;
  overviewExpandedSessions: string[];
  overviewSelectedSessionIds: string[];
  overviewSelectionMode: boolean;

  // ── Per-session actions ────────────────────────────────────────────────

  saveScrollState: (key: string, partial: Partial<ScrollState>) => void;
  getScrollState: (key: string) => ScrollState;
  clearScrollState: (key: string) => void;
  clearAllScrollStates: () => void;
  computeUnreadCount: (key: string, messageIds: string[]) => number;

  // ── Overview chrome actions ────────────────────────────────────────────

  setOverviewVisible: (v: boolean) => void;
  setOverviewWidth: (w: number) => void;
  setOverviewPosition: (p: "right" | "left") => void;
  setOverviewFilter: (f: SessionOverviewFilter) => void;
  setOverviewExpandedSessions: (sessions: string[]) => void;
  setOverviewSelectedSessionIds: (sessionIds: string[]) => void;
  toggleOverviewSelected: (sessionId: string) => void;
  setOverviewSelectionMode: (enabled: boolean) => void;
  toggleOverviewSelection: (sessionId: string) => void;

  // ── Bulk actions ───────────────────────────────────────────────────────

  /** Replace entire overview state (for message handler) */
  setOverviewState: (state: Partial<SessionOverviewState>) => void;
}

const defaultScrollState: ScrollState = {
  scrollTop: 0,
  lastSeenMessageId: null,
  streamingActive: false,
  streamingAction: null,
  streamingStartedAt: null,
};

export const useUiStateStore = create<UiStateStore>((set, get) => ({
  scrollStates: {},

  overviewVisible: false,
  overviewWidth: 280,
  overviewPosition: "right",
  overviewFilter: "all",
  overviewExpandedSessions: [],
  overviewSelectedSessionIds: [],
  overviewSelectionMode: false,

  // ── Per-session actions ────────────────────────────────────────────────

  saveScrollState: (key, partial) =>
    set(produce((draft: UiStateStore) => {
      const prev = draft.scrollStates[key] ?? defaultScrollState;
      // Only write if at least one field actually changed
      let changed = false;
      for (const [k, v] of Object.entries(partial)) {
        if ((prev as any)[k] !== v) { changed = true; break; }
      }
      if (!changed) return;
      draft.scrollStates[key] = { ...prev, ...partial };
    })),

  getScrollState: (key) => {
    return get().scrollStates[key] ?? defaultScrollState;
  },

  clearScrollState: (key) =>
    set(produce((draft: UiStateStore) => {
      delete draft.scrollStates[key];
    })),

  clearAllScrollStates: () => set({ scrollStates: {} }),

  computeUnreadCount: (key, messageIds) => {
    if (messageIds.length === 0) return 0;
    const state = get().scrollStates[key];
    if (!state || !state.lastSeenMessageId) {
      return messageIds.length;
    }
    const idx = messageIds.indexOf(state.lastSeenMessageId);
    if (idx < 0) return 0;
    return messageIds.length - idx - 1;
  },

  // ── Overview chrome actions ────────────────────────────────────────────

  setOverviewVisible: (v) => {
    log.debug("setOverviewVisible", { visible: v });
    set((s) => s.overviewVisible === v ? s : { overviewVisible: v });
  },
  setOverviewWidth: (w) => set((s) => s.overviewWidth === w ? s : { overviewWidth: w }),
  setOverviewPosition: (p) => set((s) => s.overviewPosition === p ? s : { overviewPosition: p }),
  setOverviewFilter: (f) => set((s) => s.overviewFilter === f ? s : { overviewFilter: f }),
  setOverviewExpandedSessions: (sessions) =>
    set((s) => {
      if (s.overviewExpandedSessions.length === sessions.length &&
          s.overviewExpandedSessions.every((v, i) => v === sessions[i])) return s;
      return { overviewExpandedSessions: sessions };
    }),
  setOverviewSelectedSessionIds: (sessionIds) =>
    set((s) => {
      if (s.overviewSelectedSessionIds.length === sessionIds.length &&
          s.overviewSelectedSessionIds.every((v, i) => v === sessionIds[i])) return s;
      return { overviewSelectedSessionIds: sessionIds };
    }),
  toggleOverviewSelected: (sessionId) =>
    set((s) => {
      const idx = s.overviewSelectedSessionIds.indexOf(sessionId);
      if (idx >= 0) {
        const next = s.overviewSelectedSessionIds.filter((_, i) => i !== idx);
        return next.length !== s.overviewSelectedSessionIds.length
          ? { overviewSelectedSessionIds: next }
          : s;
      }
      return { overviewSelectedSessionIds: [...s.overviewSelectedSessionIds, sessionId] };
    }),
  setOverviewSelectionMode: (enabled) =>
    set((s) => s.overviewSelectionMode === enabled ? s : { overviewSelectionMode: enabled }),
  toggleOverviewSelection: (sessionId) =>
    set((s) => {
      const idx = s.overviewSelectedSessionIds.indexOf(sessionId);
      let nextIds: string[];
      if (idx >= 0) {
        nextIds = s.overviewSelectedSessionIds.filter((_, i) => i !== idx);
      } else {
        nextIds = [...s.overviewSelectedSessionIds, sessionId];
      }
      return { overviewSelectedSessionIds: nextIds, overviewSelectionMode: true };
    }),

  // ── Bulk actions ───────────────────────────────────────────────────────

  setOverviewState: (state) =>
    set(produce((draft: UiStateStore) => {
      let changed = false;
      if (state.filter !== undefined && draft.overviewFilter !== state.filter) {
        draft.overviewFilter = state.filter; changed = true;
      }
      if (state.expandedSessions !== undefined && draft.overviewExpandedSessions !== state.expandedSessions) {
        draft.overviewExpandedSessions = state.expandedSessions; changed = true;
      }
      if (state.selectedSessionIds !== undefined && draft.overviewSelectedSessionIds !== state.selectedSessionIds) {
        draft.overviewSelectedSessionIds = state.selectedSessionIds; changed = true;
      }
      if (state.selectionMode !== undefined && draft.overviewSelectionMode !== state.selectionMode) {
        draft.overviewSelectionMode = state.selectionMode; changed = true;
      }
      if (!changed) return;
    })),
}));
