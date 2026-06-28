// Self-contained copy of src/shared/util/path.ts — webview bundle is built
// independently (esbuild IIFE) and cannot reach into src/ at build time.

const DEFAULT_MAX_LENGTH = 25;
const ELLIPSIS = "…";

export function abbreviatePath(
  inputPath: string | null | undefined,
  maxLength: number = DEFAULT_MAX_LENGTH,
): string {
  if (!inputPath) return "";

  const segments = inputPath.split("/").filter(Boolean);

  if (segments.length === 0) return "/";

  if (inputPath.length <= maxLength) return inputPath;

  if (segments.length >= 2) {
    const last = segments[segments.length - 1];
    const initials = segments.slice(0, -1).map((s) => s[0]);
    const abbreviated = `/${initials.join("/")}/${last}`;
    if (abbreviated.length <= maxLength) return abbreviated;
  }

  if (segments.length >= 3) {
    const tail = segments.slice(-2);
    const fallback = `/${ELLIPSIS}/${tail.join("/")}`;
    if (fallback.length <= maxLength) return fallback;
  }

  return inputPath.length <= maxLength ? inputPath : inputPath.slice(-maxLength);
}
