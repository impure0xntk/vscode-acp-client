import { homedir } from "os";

// ============================================================================
// Path abbreviation (fish shell style)
// ============================================================================

const DEFAULT_MAX_LENGTH = 25;
const ELLIPSIS = "…";

/**
 * Abbreviate a path in fish-shell style.
 *
 * Strategy:
 *  1. Replace homedir prefix with "~"
 *  2. If the path fits within maxLength, return as-is
 *  3. Abbreviate each intermediate segment to its first character,
 *     keeping the last segment full
 *     e.g. /home/user/github/workspace → ~/h/u/github/workspace
 *  4. If still too long, keep last 2 segments full, prepend with "…"
 */
export function abbreviatePath(
  inputPath: string | null | undefined,
  maxLength: number = DEFAULT_MAX_LENGTH,
): string {
  if (!inputPath) return "";

  const home = homedir();
  const isUnderHome = inputPath === home || inputPath.startsWith(home + "/");
  const prefix = isUnderHome ? "~" : "";
  const rest = isUnderHome ? inputPath.slice(home.length + 1) : inputPath;
  const segments = rest.split("/").filter(Boolean);

  if (segments.length === 0) return prefix || "/";

  // Reconstruct full path from ~-relative parts
  const full = prefix ? `${prefix}/${rest}` : rest;
  if (full.length <= maxLength) return full;

  // Step 1: abbreviate intermediate segments to first char, keep last full
  if (segments.length >= 2) {
    const last = segments[segments.length - 1];
    const initials = segments.slice(0, -1).map(s => s[0]);
    const abbreviated = prefix
      ? `${prefix}/${initials.join("/")}/${last}`
      : `/${initials.join("/")}/${last}`;
    if (abbreviated.length <= maxLength) return abbreviated;
  }

  // Step 2: fallback — keep last 2 segments, prepend with ellipsis
  if (segments.length >= 3) {
    const tail = segments.slice(-2);
    return prefix
      ? `${prefix}/${ELLIPSIS}/${tail.join("/")}`
      : `/${ELLIPSIS}/${tail.join("/")}`;
  }

  return full;
}
