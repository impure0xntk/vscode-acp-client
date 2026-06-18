import { create } from "zustand";

interface PathResolutionState {
  /** Session key → set of resolved file paths */
  resolvedPaths: Record<string, Set<string>>;
  addResolvedPaths: (sessionKey: string, paths: string[]) => void;
  clearSession: (sessionKey: string) => void;
  clearAll: () => void;
}

export const usePathResolutionStore = create<PathResolutionState>((set) => ({
  resolvedPaths: {},

  addResolvedPaths: (sessionKey, paths) =>
    set((state) => {
      const existing = state.resolvedPaths[sessionKey] ?? new Set<string>();
      const newPaths = paths.filter((p) => !existing.has(p));
      if (newPaths.length === 0) return state;
      const merged = new Set(existing);
      for (const p of newPaths) merged.add(p);
      return {
        resolvedPaths: {
          ...state.resolvedPaths,
          [sessionKey]: merged,
        },
      };
    }),

  clearSession: (sessionKey) =>
    set((state) => {
      if (!(sessionKey in state.resolvedPaths)) return state;
      const next = { ...state.resolvedPaths };
      delete next[sessionKey];
      return { resolvedPaths: next };
    }),

  clearAll: () => set({ resolvedPaths: {} }),
}));
