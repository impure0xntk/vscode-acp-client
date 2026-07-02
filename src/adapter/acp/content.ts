import type { ContentBlock } from "@agentclientprotocol/sdk";
import type { ContextAttachmentDTO } from "../../domain/models/chat";

// ---------------------------------------------------------------------------
// ContentBlock → ContextAttachment conversion
//
// Adapted from kilo's content.ts for client-side use:
// converts ACP ContentBlock arrays into our internal ContextAttachment format
// for the context bar and prompt construction.
// ---------------------------------------------------------------------------

/**
 * Extract all file and resource references from ContentBlock array
 * and return them as ContextAttachmentDTO entries for the context bar.
 *
 * Pure text blocks are returned as-is; file/resource/image blocks become
 * context chips with path, token estimate, and content preview.
 */
export function contentBlocksToAttachments(
  blocks: readonly ContentBlock[]
): ContextAttachmentDTO[] {
  const result: ContextAttachmentDTO[] = [];
  for (const block of blocks) {
    const attachment = blockToAttachment(block);
    if (attachment) {
      result.push(attachment);
    }
  }
  return result;
}

function blockToAttachment(block: ContentBlock): ContextAttachmentDTO | null {
  switch (block.type) {
    case "text":
      // Pure text blocks are not attachments — they go into the prompt body
      return null;

    case "resource_link":
      return resourceLinkToAttachment(block.uri, block.name);

    case "resource": {
      const res = block.resource;
      if ("text" in res) {
        return {
          id: `ctx-${hashStr(res.uri)}`,
          type: "file",
          path: extractFilePath(res.uri),
          label: extractFilePath(res.uri) || "file",
          tokenCount: estimateTokenCount(res.text),
          content: res.text,
        };
      }
      // Blob resource — just use URI as label
      return resourceLinkToAttachment(res.uri, extractFilePath(res.uri) || "file");
    }

    case "image": {
      const uri = "uri" in block ? (block.uri as string | undefined) : undefined;
      const dataUri = uri ?? `data:${block.mimeType};base64,${block.data}`;
      return {
        id: `ctx-${hashStr(dataUri)}`,
        type: "file",
        path: extractFilePath(dataUri),
        label: extractFilePath(dataUri) || "image",
        tokenCount: estimateImageTokens(block.mimeType),
        content: `[Image: ${block.mimeType}]`,
      };
    }

    default:
      return null;
  }
}

function resourceLinkToAttachment(
  uri: string,
  name?: string
): ContextAttachmentDTO {
  const path = extractFilePath(uri);
  return {
    id: `ctx-${hashStr(uri)}`,
    type: "file",
    path,
    label: name ?? path,
    tokenCount: 0, // Will be filled after content fetch
    content: "",
  };
}

// ---------------------------------------------------------------------------
// ContentBlock construction helpers
// ---------------------------------------------------------------------------

/**
 * Build a ContentBlock array from context attachments and a prompt text.
 *
 * Attachments of type "file" become resource_link blocks;
 * "selection"/"diff" become text blocks with metadata.
 */
export function buildPromptContent(
  text: string,
  attachments?: readonly ContextAttachmentDTO[]
): ContentBlock[] {
  const blocks: ContentBlock[] = [];

  if (attachments) {
    for (const att of attachments) {
      switch (att.type) {
        case "file":
          blocks.push({
            type: "resource_link",
            uri: `file://${att.path}`,
            name: att.label,
            mimeType: "text/plain",
            size: att.content.length,
          });
          break;
        case "selection": {
          const lineInfo = att.lineRange
            ? ` (lines ${att.lineRange[0]}-${att.lineRange[1]})`
            : "";
          blocks.push({
            type: "text",
            text: `# File: ${att.path}${lineInfo}\n\`\`\`\n${att.content}\n\`\`\``,
            annotations: {
              audience: ["user"],
              lastModified: undefined,
              priority: undefined,
            },
          });
          break;
        }
        case "diff":
          blocks.push({
            type: "text",
            text: `# Diff\n\`\`\`diff\n${att.content}\n\`\`\``,
            annotations: {
              audience: ["user"],
              lastModified: undefined,
              priority: undefined,
            },
          });
          break;
        case "symbol":
          blocks.push({
            type: "text",
            text: `# Symbol: ${att.label}\n\`\`\`\n${att.content}\n\`\`\``,
            annotations: {
              audience: ["user"],
              lastModified: undefined,
              priority: undefined,
            },
          });
          break;
      }
    }
  }

  blocks.push({ type: "text", text });
  return blocks;
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

function extractFilePath(uri: string): string {
  if (uri.startsWith("file://")) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { fileURLToPath } = require("node:url");
      return fileURLToPath(uri);
    } catch {
      return uri.replace(/^file:\/\//, "");
    }
  }
  // For zed:// / data: / other URIs, return the raw URI as a fallback label
  return uri.length > 80 ? uri.slice(0, 80) + "…" : uri;
}

function estimateTokenCount(text: string): number {
  // Rough estimate: ~4 characters per token (conservative)
  return Math.ceil(text.length / 4);
}

function estimateImageTokens(_mimeType: string): number {
  // Conservative estimate for a typical image in vision models
  return 85;
}

function hashStr(s: string): string {
  let hash = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i);
    hash = ((hash << 5) - hash + ch) | 0;
  }
  return Math.abs(hash).toString(16);
}
