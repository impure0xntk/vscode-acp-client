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
): Map<string, Map<number, FileEditEntry[]> | undefined> {
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
      }
    }

    return result;
  }, [writes, groups, latestGroup]);
}
