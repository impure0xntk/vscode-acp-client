// ============================================================================
// Path abbreviation (fish-shell style)
// ============================================================================

const DEFAULT_MAX_LENGTH = 25;
const ELLIPSIS = "…";

/**
 * Abbreviate a path in fish-shell style.
 *
 * Strategy:
 *  1. If the path fits within maxLength, return as-is
 *  2. Abbreviate each intermediate segment to its first character,
 *     keeping the last segment full
 *     e.g. /home/user/github/workspace → /h/u/github/workspace
 *  3. If still too long, keep last 2 segments full, prepend with "…"
 *
 * @param inputPath - Absolute path to abbreviate
 * @param maxLength - Maximum output length (default 25)
 */
export function abbreviatePath(
  inputPath: string | null | undefined,
  maxLength: number = DEFAULT_MAX_LENGTH,
): string {
  if (!inputPath) return "";

  const segments = inputPath.split("/").filter(Boolean);

  if (segments.length === 0) return "/";

  if (inputPath.length <= maxLength) return inputPath;

  // Step 1: abbreviate intermediate segments to first char, keep last full
  if (segments.length >= 2) {
    const last = segments[segments.length - 1];
    const initials = segments.slice(0, -1).map((s) => s[0]);
    const abbreviated = `/${initials.join("/")}/${last}`;
    if (abbreviated.length <= maxLength) return abbreviated;
  }

  // Step 2: fallback — keep last 2 segments, prepend with ellipsis
  if (segments.length >= 3) {
    const tail = segments.slice(-2);
    return `/${ELLIPSIS}/${tail.join("/")}`;
  }

  return inputPath;
}
