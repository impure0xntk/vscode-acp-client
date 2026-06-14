import { create } from "zustand";

export interface SessionScrollState {
  scrollTop: number;
  readUpToMessageId: string | null;
  isAtBottom: boolean;
}

const DEFAULT: SessionScrollState = {
  scrollTop: 0,
  readUpToMessageId: null,
  isAtBottom: true,
};

interface ScrollStateStore {
  perSession: Record<string, SessionScrollState>;
  setScrollTop: (key: string, v: number) => void;
  setReadUpTo: (key: string, id: string | null) => void;
  setIsAtBottom: (key: string, v: boolean) => void;
  removeSession: (key: string) => void;
}

export const useScrollStateStore = create<ScrollStateStore>((set) => ({
  perSession: {},

  setScrollTop: (key, v) =>
    set((s) => {
      const p = s.perSession[key] ?? DEFAULT;
      if (p.scrollTop === v) return s;
      return { perSession: { ...s.perSession, [key]: { ...p, scrollTop: v } } };
    }),

  setReadUpTo: (key, id) =>
    set((s) => {
      const p = s.perSession[key] ?? DEFAULT;
      if (p.readUpToMessageId === id) return s;
      return { perSession: { ...s.perSession, [key]: { ...p, readUpToMessageId: id } } };
    }),

  setIsAtBottom: (key, v) =>
    set((s) => {
      const p = s.perSession[key] ?? DEFAULT;
      if (p.isAtBottom === v) return s;
      return { perSession: { ...s.perSession, [key]: { ...p, isAtBottom: v } } };
    }),

  removeSession: (key) =>
    set((s) => {
      if (!(key in s.perSession)) return s;
      const n = { ...s.perSession };
      delete n[key];
      return { perSession: n };
    }),
}));
