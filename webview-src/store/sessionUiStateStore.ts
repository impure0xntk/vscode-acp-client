import { create } from "zustand";

// ── Per-session UI state ────────────────────────────────────────────────────

export interface SessionUiState {
  /** ScrollTop of the chat container when the session was last active */
  scrollTop: number;
  /** ID of the last message the user has seen (scrolled past) */
  lastSeenMessageId: string | null;
}

interface SessionUiStateStore {
  /** sessionKey → UI state */
  states: Record<string, SessionUiState>;

  /** Upsert partial state for a session key */
  save: (key: string, partial: Partial<SessionUiState>) => void;

  /** Read state for a session key. Returns default if missing. */
  restore: (key: string) => SessionUiState;

  /** Remove state for a closed session */
  clear: (key: string) => void;

  /** Remove all states (e.g. on full reset) */
  clearAll: () => void;

  /** Compute unread count: messages after lastSeenMessageId */
  computeUnreadCount: (key: string, messageIds: string[]) => number;
}

const defaultState: SessionUiState = {
  scrollTop: 0,
  lastSeenMessageId: null,
};

export const useSessionUiStateStore = create<SessionUiStateStore>((set, get) => ({
  states: {},

  save: (key, partial) =>
    set((s) => {
      const prev = s.states[key] ?? defaultState;
      return {
        states: {
          ...s.states,
          [key]: { ...prev, ...partial },
        },
      };
    }),

  restore: (key) => {
    return get().states[key] ?? defaultState;
  },

  clear: (key) =>
    set((s) => {
      const next = { ...s.states };
      delete next[key];
      return { states: next };
    }),

  clearAll: () => set({ states: {} }),

  computeUnreadCount: (key, messageIds) => {
    if (messageIds.length === 0) return 0;
    const state = get().states[key];
    if (!state || !state.lastSeenMessageId) {
      // Never seen → all messages are unread
      return messageIds.length;
    }
    const idx = messageIds.indexOf(state.lastSeenMessageId);
    if (idx < 0) return 0;
    return messageIds.length - idx - 1;
  },
}));
