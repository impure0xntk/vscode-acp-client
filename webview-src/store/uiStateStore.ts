import { create } from "zustand";
import type { SessionOverviewFilter, SessionOverviewState } from "../types";

// ── Constants ───────────────────────────────────────────────────────────────

export const SCROLL_BOTTOM_THRESHOLD = 100;

// ── Store shape ──────────────────────────────────────────────────────────────
// NOTE: Scroll state (isAtBottom, unreadCount, etc.) is NOT stored here.
// It is derived locally in ChatArea from raw DOM scroll events to avoid
// Zustand → useSyncExternalStore → infinite re-render loops.

interface UiStateStore {
  // Panel mode: "classic" | "unified" | "supervisor" (multi-agent lead-worker)
  panelMode: "classic" | "unified" | "supervisor";

  // Overview panel chrome
  overviewVisible: boolean;
  overviewWidth: number;
  overviewPosition: "right" | "left";
  overviewFilter: SessionOverviewFilter;
  overviewExpandedSessions: string[];
  overviewSelectedSessionIds: string[];
  overviewSelectionMode: boolean;

  // ── Panel mode ─────────────────────────────────────────────────────────

  setPanelMode: (mode: "classic" | "unified" | "supervisor") => void;

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

  setOverviewState: (state: Partial<SessionOverviewState>) => void;
}

export const useUiStateStore = create<UiStateStore>((set) => ({
  panelMode: "classic",

  setPanelMode: (mode) =>
    set((state) => (state.panelMode === mode ? state : { panelMode: mode })),

  overviewVisible: false,
  overviewWidth: 280,
  overviewPosition: "right",
  overviewFilter: "all",
  overviewExpandedSessions: [],
  overviewSelectedSessionIds: [],
  overviewSelectionMode: false,

  setOverviewVisible: (v: boolean) =>
    set((state) => {
      if (state.overviewVisible === v) return state;
      return { ...state, overviewVisible: v };
    }),

  setOverviewWidth: (w: number) =>
    set((state) => {
      if (state.overviewWidth === w) return state;
      return { ...state, overviewWidth: w };
    }),

  setOverviewPosition: (p: "right" | "left") =>
    set((state) => {
      if (state.overviewPosition === p) return state;
      return { ...state, overviewPosition: p };
    }),

  setOverviewFilter: (f: SessionOverviewFilter) =>
    set((state) => {
      if (state.overviewFilter === f) return state;
      return { ...state, overviewFilter: f };
    }),

  setOverviewExpandedSessions: (sessions: string[]) =>
    set((state) => {
      if (
        state.overviewExpandedSessions.length === sessions.length &&
        state.overviewExpandedSessions.every((v, i) => v === sessions[i])
      )
        return state;
      return { ...state, overviewExpandedSessions: sessions };
    }),

  setOverviewSelectedSessionIds: (sessionIds: string[]) =>
    set((state) => {
      if (
        state.overviewSelectedSessionIds.length === sessionIds.length &&
        state.overviewSelectedSessionIds.every((v, i) => v === sessionIds[i])
      )
        return state;
      return { ...state, overviewSelectedSessionIds: sessionIds };
    }),

  toggleOverviewSelected: (sessionId: string) =>
    set((state) => {
      const idx = state.overviewSelectedSessionIds.indexOf(sessionId);
      if (idx >= 0) {
        const next = state.overviewSelectedSessionIds.filter(
          (_, i) => i !== idx
        );
        return next.length !== state.overviewSelectedSessionIds.length
          ? { ...state, overviewSelectedSessionIds: next }
          : state;
      }
      return {
        ...state,
        overviewSelectedSessionIds: [
          ...state.overviewSelectedSessionIds,
          sessionId,
        ],
      };
    }),

  setOverviewSelectionMode: (enabled: boolean) =>
    set((state) =>
      state.overviewSelectionMode === enabled
        ? state
        : { ...state, overviewSelectionMode: enabled }
    ),

  toggleOverviewSelection: (sessionId: string) =>
    set((state) => {
      const idx = state.overviewSelectedSessionIds.indexOf(sessionId);
      let nextIds: string[];
      if (idx >= 0) {
        nextIds = state.overviewSelectedSessionIds.filter((_, i) => i !== idx);
      } else {
        nextIds = [...state.overviewSelectedSessionIds, sessionId];
      }
      return {
        ...state,
        overviewSelectedSessionIds: nextIds,
        overviewSelectionMode: true,
      };
    }),

  setOverviewState: (ovState: Partial<SessionOverviewState>) =>
    set((state) => {
      let changed = false;
      const next = { ...state };
      if (
        ovState.filter !== undefined &&
        next.overviewFilter !== ovState.filter
      ) {
        next.overviewFilter = ovState.filter;
        changed = true;
      }
      if (
        ovState.expandedSessions !== undefined &&
        next.overviewExpandedSessions !== ovState.expandedSessions
      ) {
        next.overviewExpandedSessions = ovState.expandedSessions;
        changed = true;
      }
      if (
        ovState.selectedSessionIds !== undefined &&
        next.overviewSelectedSessionIds !== ovState.selectedSessionIds
      ) {
        next.overviewSelectedSessionIds = ovState.selectedSessionIds;
        changed = true;
      }
      if (
        ovState.selectionMode !== undefined &&
        next.overviewSelectionMode !== ovState.selectionMode
      ) {
        next.overviewSelectionMode = ovState.selectionMode;
        changed = true;
      }
      return changed ? next : state;
    }),
}));
