// ---------------------------------------------------------------------------
// Path pattern matching — shared logic for extracting file-path-like tokens
// from text content. Mirrors the regex used in chatPanel.ts (extension host).
// ---------------------------------------------------------------------------

const LOOKS_LIKE_PATH_RE =
  /^(\.{0,2}\/|~\/|\/|[A-Za-z]:\\)[\w./~$-]+(?:\.[a-zA-Z0-9]+)?$|^[\w./-]+\/[\w./-]+$/;

/**
 * Extract tokens from text that look like file paths.
 * Filters out URLs, overly-long tokens, and non-path strings.
 */
export function extractCandidatePaths(text: string): string[] {
  const tokens = text.split(/[\s,;:|"'()[\]{}<>]+/).filter(Boolean);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of tokens) {
    const trimmed = t.trim();
    if (trimmed.length > 260) continue;
    if (/^https?:\/\//.test(trimmed)) continue;
    if (!LOOKS_LIKE_PATH_RE.test(trimmed)) continue;
    if (seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}
