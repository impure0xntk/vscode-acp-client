import type { ContextAttachment } from "../types";

/** Derive a concise display label per attachment type. */
export function attachmentLabel(a: ContextAttachment): string {
  const name = a.path.split("/").pop() ?? a.path;
  switch (a.type) {
    case "selection":
      return a.lineRange ? `${name}:${a.lineRange[0]}-${a.lineRange[1]}` : name;
    case "symbol":
      return a.label;
    case "diff":
      return "diff";
    case "problem":
      // Show the diagnostic message so the chip reveals the error at a glance;
      // fall back to the file:line label when the message is unavailable.
      return a.message ? a.message : a.label || name;
    case "turn":
      // A forwarded prior-turn output — show the source session title (or
      // fallback to the generated label) since there is no file to name.
      return a.message ? a.message : a.label || "turn";
    case "file":
    default:
      return name;
  }
}
