import { create } from "zustand";

// ── Types ──────────────────────────────────────────────────────────────────

/** Per-session, per-group collapse flags. true = collapsed, false = expanded. */
export type IntermediateStepsCollapseMap = Record<
  string,
  Record<string, boolean>
>;

interface IntermediateStepsStore {
  collapseMap: IntermediateStepsCollapseMap;
  setCollapsed: (
    sessionKey: string,
    groupId: string,
    collapsed: boolean
  ) => void;
  toggle: (sessionKey: string, groupId: string) => void;
}

export const useIntermediateStepsStore = create<IntermediateStepsStore>(
  (set) => ({
    collapseMap: {},

    setCollapsed: (sessionKey, groupId, collapsed) =>
      set((s) => {
        const session = s.collapseMap[sessionKey] ?? {};
        if (session[groupId] === collapsed) return s;
        return {
          collapseMap: {
            ...s.collapseMap,
            [sessionKey]: { ...session, [groupId]: collapsed },
          },
        };
      }),

    toggle: (sessionKey, groupId) =>
      set((s) => {
        const session = s.collapseMap[sessionKey] ?? {};
        const current = session[groupId] ?? true; // default: collapsed
        const next = !current;
        if (current === next) return s;
        if (session[groupId] === undefined && next === true) return s;
        return {
          collapseMap: {
            ...s.collapseMap,
            [sessionKey]: { ...session, [groupId]: next },
          },
        };
      }),
  })
);
