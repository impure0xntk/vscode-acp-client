// Path pattern matching — shared logic for extracting file-path-like tokens from text content.
// Mirrors the regex used in chatPanel.ts (extension host).

// Hyphen must be at end of char class to avoid range interpretation.
// [\w./~$-] is parsed as range "$-]" (U+0024..U+005D), silently dropping $ and -.
const LOOKS_LIKE_PATH_RE =
  /^(?:(?:\.{0,2}\/|~\/)[\w./~$/-]+(?:\.[a-zA-Z0-9]+)?|\/[\w./~$/-]+(?:\.[a-zA-Z0-9]+)?|[\w./~$/-]+\/[\w./~$/-]+|\.\w[\w.-]*|(?:Makefile|Dockerfile|LICENSE|README|Vagrantfile|Rakefile|Gemfile|Justfile|Procfile)|[A-Za-z]:\\(?:[\w./~$/-]+\\)*[\w./~$/-]+(?:\.[a-zA-Z0-9]+)?|@[\w.-]*\/[\w./~$/-]+)$/;

/**
 * Extract tokens from text that look like file paths.
 * Filters out URLs, overly-long tokens, and non-path strings.
 */
export function extractCandidatePaths(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];

  // Windows paths use backslash separators which would break normal tokenization
  const winRe = /[A-Za-z]:\\(?:[\w./~$/-]+\\)*[\w./~$/-]+(?:\.[a-zA-Z0-9]+)?/g;
  let wm: RegExpExecArray | null;
  while ((wm = winRe.exec(text)) !== null) {
    const p = wm[0];
    if (p.length <= 260 && !seen.has(p)) {
      seen.add(p);
      out.push(p);
    }
  }

  const tokens = text.split(/[\s,;:|"'`()[\]{}<>]+/).filter(Boolean);
  for (const t of tokens) {
    const trimmed = t.replace(/\.+$/, "");
    if (trimmed.length === 0) continue;
    if (trimmed.length > 260) continue;
    if (/^https?:\/\//.test(trimmed)) continue;
    if (/^\/\//.test(trimmed)) continue;
    if (!LOOKS_LIKE_PATH_RE.test(trimmed)) continue;
    if (seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}
