// ============================================================================
// Mesh Marker Parser — extract P2P messages from agent output streams
//
// Supports two formats (design §14):
//   Primary:   [ACP_MESH_MESSAGE]{json}[/ACP_MESH_MESSAGE]
//   Fallback:  [ACP_MESH_MESSAGE]\nkey: value\n[/ACP_MESH_MESSAGE]
//
// refs: docs/p2p-mesh-design.md Section 10, 14.4
// ============================================================================

import type {
  P2PMessage,
  P2PMessageType,
  MarkerEnvelope,
  MessagePayload,
} from "../../domain/models/mesh";
import { MESH_MARKER_OPEN, MESH_MARKER_CLOSE } from "../../domain/models/mesh";

// ----------------------------------------------------------------------------
// Parse result
// ----------------------------------------------------------------------------

export interface ParseResult {
  /** Messages extracted from the raw output */
  messages: P2PMessage[];
  /** Output with markers removed (safe to display to user) */
  sanitized: string;
}

// ----------------------------------------------------------------------------
// Regex (pre-compiled for performance)
// ----------------------------------------------------------------------------

const MARKER_RE = new RegExp(
  escapeRe(MESH_MARKER_OPEN) + // [ACP_MESH_MESSAGE]
    "([\\s\\S]*?)" + // captured content (non-greedy)
    escapeRe(MESH_MARKER_CLOSE), // [/ACP_MESH_MESSAGE]
  "g"
);

// ----------------------------------------------------------------------------
// Public API
// ----------------------------------------------------------------------------

/**
 * Scan raw agent output for mesh markers, extract P2P messages,
 * and return the sanitized (marker-free) output.
 */
export function parseMeshMarkers(raw: string, from: string): ParseResult {
  const messages: P2PMessage[] = [];
  let sanitized = raw;
  let match: RegExpExecArray | null;

  // Reset regex state
  MARKER_RE.lastIndex = 0;

  const replacements: Array<{ start: number; end: number }> = [];

  while ((match = MARKER_RE.exec(raw)) !== null) {
    const content = match[1]?.trim();
    if (!content) continue;

    const envelope = tryParseEnvelope(content);
    if (!envelope) continue;

    const msg: P2PMessage = {
      id: envelope.id,
      type: envelope.type,
      from,
      to: envelope.to,
      timestamp: new Date(),
      payload: envelope.payload as MessagePayload,
      metadata: envelope.metadata,
    };

    messages.push(msg);
    replacements.push({
      start: match.index,
      end: match.index + match[0].length,
    });
  }

  // Build sanitized string by replacing markers (reverse order to preserve indices)
  if (replacements.length > 0) {
    const parts: string[] = [];
    let cursor = 0;
    for (const r of replacements) {
      parts.push(raw.slice(cursor, r.start));
      cursor = r.end;
    }
    parts.push(raw.slice(cursor));
    sanitized = parts.join("");
  }

  return { messages, sanitized };
}

/**
 * Serialize a P2PMessage into the marker format for embedding in agent prompts.
 */
export function serializeToMarker(message: P2PMessage): string {
  const envelope: MarkerEnvelope = {
    version: "1.0",
    type: message.type,
    id: message.id,
    to: message.to,
    payload: message.payload,
    metadata: message.metadata,
  };
  return `${MESH_MARKER_OPEN}${JSON.stringify(envelope)}${MESH_MARKER_CLOSE}`;
}

// ----------------------------------------------------------------------------
// Internal parsers
// ----------------------------------------------------------------------------

function tryParseEnvelope(content: string): MarkerEnvelope | null {
  // Try JSON first (primary format)
  try {
    const obj = JSON.parse(content);
    if (isValidEnvelope(obj)) {
      return obj as MarkerEnvelope;
    }
  } catch {
    // Not JSON — try fallback key-value format
  }

  // Fallback: key: value per line
  return parseKeyValueEnvelope(content);
}

function parseKeyValueEnvelope(content: string): MarkerEnvelope | null {
  const lines = content.split("\n");
  const map = new Map<string, string>();

  for (const line of lines) {
    const idx = line.indexOf(":");
    if (idx < 0) continue;
    const key = line.slice(0, idx).trim();
    const val = line.slice(idx + 1).trim();
    map.set(key, val);
  }

  const type = map.get("type") as P2PMessageType | undefined;
  const id = map.get("id") ?? "";
  const to = map.get("to") ?? "broadcast";

  if (!type) return null;

  return {
    version: "1.0",
    type,
    id,
    to,
    payload: {}, // Fallback format doesn't carry typed payload
  };
}

// ----------------------------------------------------------------------------
// Type guard
// ----------------------------------------------------------------------------

function isValidEnvelope(obj: unknown): obj is MarkerEnvelope {
  if (typeof obj !== "object" || obj === null) return false;
  const o = obj as Record<string, unknown>;
  return (
    typeof o.type === "string" &&
    typeof o.to === "string" &&
    o.payload !== undefined
  );
}

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
