import type { ClassifiedMessage, FilterConfig } from "../types";

/**
 * Filter messages based on classification and config.
 * Returns true if the message should be kept.
 */
function shouldKeep(msg: ClassifiedMessage, config: FilterConfig): boolean {
  if (config.hideCompression && msg.systemKind === "compression") return false;
  if (config.hideModeChange && msg.systemKind === "mode_change") return false;
  if (config.hideErrorNotices && msg.systemKind === "error_notice")
    return false;
  if (config.customPredicate && !config.customPredicate(msg)) return false;
  return true;
}

/**
 * Filter an array of classified messages.
 */
export function filterMessages(
  messages: ClassifiedMessage[],
  config: FilterConfig
): ClassifiedMessage[] {
  return messages.filter((msg) => shouldKeep(msg, config));
}
