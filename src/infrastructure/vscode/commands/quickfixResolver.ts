import type { ContextAttachmentDTO } from "../../../domain/models/chat";
import type { SerializedRange } from "../../../adapter/context/assembler";

/** Arguments threaded from the code-action provider to the command. */
export interface FixSelectionArgs {
  /** Document URI the Quick Fix was invoked on (stringified vscode.Uri). */
  uri?: string;
  /** Range the Quick Fix was invoked on (0-based, end-exclusive). */
  range?: SerializedRange;
}

/**
 * Decide which attachment to inject into the Composer for the "Fix selection
 * with agent" Quick Fix.
 *
 * Prefers the explicit `range` the action was invoked on (so a problem /
 * diagnostic range attaches even when the active editor selection is empty),
 * then falls back to the active editor selection (e.g. when invoked directly
 * from the command palette without range args).
 */
export async function resolveFixAttachment(
  args: FixSelectionArgs | undefined,
  resolveRangeAt: (
    uri: string,
    range: SerializedRange
  ) => Promise<ContextAttachmentDTO | null>,
  resolveSelection: () => Promise<ContextAttachmentDTO | null>
): Promise<ContextAttachmentDTO | null> {
  if (args?.uri && args.range) {
    const attachment = await resolveRangeAt(args.uri, args.range);
    if (attachment) return attachment;
  }
  return resolveSelection();
}
