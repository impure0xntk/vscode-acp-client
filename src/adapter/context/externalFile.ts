import type { ContextAttachmentDTO } from "../../domain/models/chat";

export type ExternalFileUri = { fsPath: string };

/**
 * Resolve a set of externally-selected file URIs (chosen via a native
 * file dialog, typically outside the workspace) into context attachments.
 *
 * Each path is resolved through the same `resolveFile` used by the in-workspace
 * `#file` picker, so external files are attached with their full content inline
 * as ACP resource blocks. Files that cannot be read (e.g. directories,
 * unreadable paths) are skipped rather than aborting the whole batch.
 */
export async function collectExternalFileAttachments(
  uris: ExternalFileUri[],
  resolveFile: (path: string, cwd?: string) => Promise<ContextAttachmentDTO>
): Promise<ContextAttachmentDTO[]> {
  const attachments: ContextAttachmentDTO[] = [];
  for (const uri of uris) {
    try {
      const attachment = await resolveFile(uri.fsPath);
      attachments.push(attachment);
    } catch {
      // Skip files that fail to resolve (unreadable / directories, etc.)
    }
  }
  return attachments;
}
