import { useMemo } from "react";
import { useFileWriteStore } from "../store/fileWriteStore";
import { buildSummaryFromWrites, lowerBound } from "../pipeline/stages/grouping";
import type { FileEditEntry } from "../pipeline/types";
import type { FileWriteRecord } from "../store/fileWriteStore";

const EMPTY_WRITES: readonly FileWriteRecord[] = [];

/**
 * Hook that computes per-step file edit summaries from fileWriteStore.
 * Caller must pass pre-computed boundaries (via useStepBoundaries).
 */
export function useFileEditSummaryMap(
  agentId: string,
  sessionId: string,
  boundaries: { lo: number; hi: number }[],
): Map<number, FileEditEntry[]> | undefined {
  const writes = useFileWriteStore((s) => {
    const key = `${agentId}:${sessionId}`;
    return s.writes[key] ?? EMPTY_WRITES;
  });

  return useMemo(() => {
    if (writes.length === 0 || boundaries.length === 0) return undefined;

    const sortedWrites = [...writes].sort((a, b) => a.seq - b.seq);
    const result = new Map<number, FileEditEntry[]>();

    let writeIdx = 0;
    for (let i = 0; i < boundaries.length; i++) {
      const { lo, hi } = boundaries[i];
      writeIdx = lowerBound(sortedWrites, lo, writeIdx);

      const stepWrites: FileWriteRecord[] = [];
      while (writeIdx < sortedWrites.length && sortedWrites[writeIdx].seq < hi) {
        stepWrites.push(sortedWrites[writeIdx]);
        writeIdx++;
      }

      if (stepWrites.length > 0) {
        const summary = buildSummaryFromWrites(stepWrites);
        if (summary) result.set(i, summary);
      }
    }

    return result;
  }, [writes, boundaries]);
}
