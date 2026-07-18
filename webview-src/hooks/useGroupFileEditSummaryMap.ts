import { useMemo } from "react";
import { useFileWriteStore } from "../store/fileWriteStore";
import {
  buildSummaryFromWrites,
  lowerBound,
} from "../pipeline/stages/grouping";
import type { FileEditEntry } from "../pipeline/types";
import type { FileWriteRecord } from "../store/fileWriteStore";
import type { AgentResponseGroup } from "../pipeline/stages/grouping";

const EMPTY_WRITES: readonly FileWriteRecord[] = [];

/**
 * Compute write-seq boundaries for a group's steps, plus a final boundary
 * for the final response if present.
 */
function computeGroupBoundaries(
  group: AgentResponseGroup
): { lo: number; hi: number }[] {
  const boundaries: { lo: number; hi: number }[] = [];

  // Boundaries for each step in the group
  for (let i = 0; i < group.steps.length; i++) {
    const step = group.steps[i];
    const lo = step.agentMessage?.writeSeq ?? 0;
    const hi =
      i + 1 < group.steps.length
        ? (group.steps[i + 1].agentMessage?.writeSeq ?? Infinity)
        : Infinity;
    boundaries.push({ lo, hi });
  }

  // If there's a finalResponse, add a virtual boundary for it
  if (group.finalResponse) {
    const finalWriteSeq =
      (group.finalResponse.item as { writeSeq?: number | null }).writeSeq ?? 0;
    boundaries.push({ lo: finalWriteSeq, hi: Infinity });

    // Shrink preceding boundary to avoid overlap
    if (boundaries.length >= 2) {
      const prev = boundaries[boundaries.length - 2];
      if (prev.hi > finalWriteSeq) prev.hi = finalWriteSeq;
    }
  }

  return boundaries;
}

interface GroupFileEditSummaryMaps {
  /**
   * Per-group file edit summary maps, keyed by group userItem.key.
   * Each value is a Map from step boundary index to FileEditEntry[],
   * or undefined when the group has no file writes.
   */
  groupMaps: Map<string, Map<number, FileEditEntry[]> | undefined>;
  /**
   * Latest group's file edit summary for the *current step* (the step shown
   * outside the banner), computed from the latest writes in the store.
   *
   * This is the authoritative source for the latest group's current step
   * file edits.  It must NOT be taken from `groupMaps.get(key).get(olderSteps.length)`
   * — `computeGroupBoundaries` produces one boundary per step PLUS one extra
   * boundary for the final response, so the last step's summary lives at
   * index `boundaries.length - 2` (or `steps.length - 1` when there is no
   * final response), never at `olderSteps.length`.  Reading at
   * `olderSteps.length` returns undefined and falls back to a stale
   * `step.fileEditSummary` captured at grouping time, which is exactly the
   * "only the first edit shows" bug when the same file is written twice.
   *
   * Computed directly from the latest writes so it always reflects the most
   * recent edit even when `groups`/`latestGroup` object references are stable
   * (file_write arrivals do not change `items`, so grouping does not re-run).
   */
  latestCurrentStepSummary: FileEditEntry[] | undefined;
}

/**
 * Extract the summary for the last step boundary of a group.  Boundaries are
 * 1:1 with steps, plus an optional trailing final-response boundary that
 * carries no writes of its own (it reuses the final step's seq).  The last
 * *step* boundary is therefore the last index that holds writes.
 */
function lastStepSummary(
  map: Map<number, FileEditEntry[]> | undefined
): FileEditEntry[] | undefined {
  if (!map || map.size === 0) return undefined;
  // Boundaries are contiguous 0..n-1; the highest key with a value is the
  // last step.  Iterate to find the maximum key (maps preserve insertion order).
  let last: FileEditEntry[] | undefined;
  for (const [, v] of map) last = v;
  return last;
}

/**
 * Hook that computes per-step file edit summaries for multiple groups.
 * Returns a Map from group key to its fileEditSummaryMap (Map from step index to FileEditEntry[]).
 * This replaces the global fileEditSummaryMap that only worked for latestGroup.
 */
export function useGroupFileEditSummaryMaps(
  agentId: string,
  sessionId: string,
  groups: AgentResponseGroup[],
  latestGroup: AgentResponseGroup | null
): GroupFileEditSummaryMaps {
  const writes = useFileWriteStore((s) => {
    const key = `${agentId}:${sessionId}`;
    return s.writes[key] ?? EMPTY_WRITES;
  });

  return useMemo(() => {
    const result = new Map<string, Map<number, FileEditEntry[]> | undefined>();

    // Process all historical groups
    for (const group of groups) {
      const boundaries = computeGroupBoundaries(group);
      if (writes.length === 0 || boundaries.length === 0) {
        result.set(group.userItem.key, undefined);
        continue;
      }

      const sortedWrites = [...writes].sort((a, b) => a.seq - b.seq);
      const groupMap = new Map<number, FileEditEntry[]>();
      let writeIdx = 0;
      for (let i = 0; i < boundaries.length; i++) {
        const { lo, hi } = boundaries[i];
        writeIdx = lowerBound(sortedWrites, lo, writeIdx);

        const stepWrites: FileWriteRecord[] = [];
        while (
          writeIdx < sortedWrites.length &&
          sortedWrites[writeIdx].seq < hi
        ) {
          stepWrites.push(sortedWrites[writeIdx]);
          writeIdx++;
        }

        if (stepWrites.length > 0) {
          const summary = buildSummaryFromWrites(stepWrites);
          if (summary) groupMap.set(i, summary);
        }
      }
      result.set(group.userItem.key, groupMap.size > 0 ? groupMap : undefined);
    }

    // Process latest group
    let latestCurrentStepSummary: FileEditEntry[] | undefined;
    if (latestGroup) {
      const boundaries = computeGroupBoundaries(latestGroup);
      if (writes.length === 0 || boundaries.length === 0) {
        result.set(latestGroup.userItem.key, undefined);
      } else {
        const sortedWrites = [...writes].sort((a, b) => a.seq - b.seq);
        const groupMap = new Map<number, FileEditEntry[]>();
        let writeIdx = 0;
        for (let i = 0; i < boundaries.length; i++) {
          const { lo, hi } = boundaries[i];
          writeIdx = lowerBound(sortedWrites, lo, writeIdx);

          const stepWrites: FileWriteRecord[] = [];
          while (
            writeIdx < sortedWrites.length &&
            sortedWrites[writeIdx].seq < hi
          ) {
            stepWrites.push(sortedWrites[writeIdx]);
            writeIdx++;
          }

          if (stepWrites.length > 0) {
            const summary = buildSummaryFromWrites(stepWrites);
            if (summary) groupMap.set(i, summary);
          }
        }
        result.set(
          latestGroup.userItem.key,
          groupMap.size > 0 ? groupMap : undefined
        );
        // The current step (rendered outside the banner) corresponds to the
        // last *step* boundary — not olderSteps.length.  Derive it from the
        // latest writes so it reflects repeated edits to the same file.
        latestCurrentStepSummary = lastStepSummary(groupMap);
      }
    }

    return { groupMaps: result, latestCurrentStepSummary };
  }, [writes, groups, latestGroup]);
}
