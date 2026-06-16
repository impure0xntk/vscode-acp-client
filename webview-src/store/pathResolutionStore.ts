import { create } from "zustand";

interface PathResolutionState {
  resolvedPaths: Record<string, string[]>;
  addResolvedPaths: (sessionKey: string, paths: string[]) => void;
  clearSession: (sessionKey: string) => void;
  clearAll: () => void;
}

export const usePathResolutionStore = create<PathResolutionState>((set) => ({
  resolvedPaths: {},

  addResolvedPaths: (sessionKey, paths) =>
    set((state) => {
      const existing = state.resolvedPaths[sessionKey] ?? [];
      const newPaths = paths.filter((p) => !existing.includes(p));
      if (newPaths.length === 0) return state;
      return {
        resolvedPaths: {
          ...state.resolvedPaths,
          [sessionKey]: [...existing, ...newPaths],
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
