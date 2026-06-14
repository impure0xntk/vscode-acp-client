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
    set({ overviewVisible: v });
  },
  setOverviewWidth: (w) => set({ overviewWidth: w }),
  setOverviewPosition: (p) => set({ overviewPosition: p }),
  setOverviewFilter: (f) => set({ overviewFilter: f }),
  setOverviewExpandedSessions: (sessions) =>
    set({ overviewExpandedSessions: sessions }),
  setOverviewSelectedSessionIds: (sessionIds) =>
    set({ overviewSelectedSessionIds: sessionIds }),
  toggleOverviewSelected: (sessionId) =>
    set(produce((draft: UiStateStore) => {
      const idx = draft.overviewSelectedSessionIds.indexOf(sessionId);
      if (idx >= 0) {
        draft.overviewSelectedSessionIds.splice(idx, 1);
      } else {
        draft.overviewSelectedSessionIds.push(sessionId);
      }
    })),
  setOverviewSelectionMode: (enabled) =>
    set({ overviewSelectionMode: enabled }),
  toggleOverviewSelection: (sessionId) =>
    set(produce((draft: UiStateStore) => {
      const idx = draft.overviewSelectedSessionIds.indexOf(sessionId);
      if (idx >= 0) {
        draft.overviewSelectedSessionIds.splice(idx, 1);
      } else {
        draft.overviewSelectedSessionIds.push(sessionId);
      }
      draft.overviewSelectionMode = true;
    })),

  // ── Bulk actions ───────────────────────────────────────────────────────

  setOverviewState: (state) =>
    set(produce((draft: UiStateStore) => {
      if (state.filter !== undefined) draft.overviewFilter = state.filter;
      if (state.expandedSessions !== undefined)
        draft.overviewExpandedSessions = state.expandedSessions;
      if (state.selectedSessionIds !== undefined)
        draft.overviewSelectedSessionIds = state.selectedSessionIds;
      if (state.selectionMode !== undefined)
        draft.overviewSelectionMode = state.selectionMode;
    })),
}));
