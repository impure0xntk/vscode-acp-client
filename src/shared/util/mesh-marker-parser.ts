// ============================================================================
// Mesh Marker Parser — extract P2P messages from agent output streams
//
// Supports two formats (design §14):
//   v1: [ACP_MESH_MESSAGE]{json}[/ACP_MESH_MESSAGE]
//   v2: [ACP_MESH_MESSAGE v2]{json}[/ACP_MESH_MESSAGE]
//   Fallback (v1 only): [ACP_MESH_MESSAGE]\nkey: value\n[/ACP_MESH_MESSAGE]
//
// refs: docs/p2p-mesh-design.md Section 10, 14.4
// ============================================================================

import type {
  P2PMessage,
  P2PMessageType,
  MarkerEnvelope,
  MessagePayload,
  MeshMarkerEnvelope,
} from "../../domain/models/mesh";
import {
  MESH_MARKER_OPEN,
  MESH_MARKER_CLOSE,
  MESH_MARKER_V2_OPEN,
} from "../../domain/models/mesh";

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
//
// v2 regex tried first (longer prefix match), then v1.
// Both share the same close delimiter [/ACP_MESH_MESSAGE].
// ----------------------------------------------------------------------------

const MARKER_V2_RE = new RegExp(
  escapeRe(MESH_MARKER_V2_OPEN) + // [ACP_MESH_MESSAGE v2]
    "([\\s\\S]*?)" + // captured content (non-greedy)
    escapeRe(MESH_MARKER_CLOSE), // [/ACP_MESH_MESSAGE]
  "g"
);

const MARKER_V1_RE = new RegExp(
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
 *
 * Tries v2 markers first, then v1. For v2 messages the `from` field
 * in the envelope is used; for v1 messages the `from` parameter is used.
 */
export function parseMeshMarkers(raw: string, from: string): ParseResult {
  const messages: P2PMessage[] = [];
  const replacements: Array<{ start: number; end: number }> = [];

  // Try v2 markers first (longer prefix must be matched before v1)
  extractMarkers(raw, MARKER_V2_RE, from, messages, replacements, true);

  // Then v1 markers — but skip ranges already matched by v2
  const v2Ranges = replacements.map((r) => ({ start: r.start, end: r.end }));
  extractMarkers(raw, MARKER_V1_RE, from, messages, replacements, false, v2Ranges);

  // Sort replacements by position for sanitized output construction
  replacements.sort((a, b) => a.start - b.start);

  // Build sanitized string by removing matched ranges
  let sanitized: string;
  if (replacements.length > 0) {
    const parts: string[] = [];
    let cursor = 0;
    for (const r of replacements) {
      parts.push(raw.slice(cursor, r.start));
      cursor = r.end;
    }
    parts.push(raw.slice(cursor));
    sanitized = parts.join("");
  } else {
    sanitized = raw;
  }

  return { messages, sanitized };
}

/**
 * Extract markers using the given regex, appending to messages and replacements.
 * When isV2 is true, the envelope's `from` field is used instead of the parameter.
 * v2SkipRanges prevents v1 regex from matching inside already-consumed v2 regions.
 */
function extractMarkers(
  raw: string,
  regex: RegExp,
  from: string,
  messages: P2PMessage[],
  replacements: Array<{ start: number; end: number }>,
  isV2: boolean,
  v2SkipRanges: Array<{ start: number; end: number }> = []
): void {
  regex.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(raw)) !== null) {
    // For v1, skip if this match overlaps with any v2 range
    if (!isV2 && v2SkipRanges.length > 0) {
      const overlaps = v2SkipRanges.some(
        (r) => match!.index < r.end && match!.index + match![0].length > r.start
      );
      if (overlaps) continue;
    }

    const content = match[1]?.trim();
    if (!content) continue;

    const envelope = tryParseEnvelope(content, isV2);
    if (!envelope) continue;

    const msg: P2PMessage = {
      id: envelope.id,
      type: envelope.type,
      from: isV2 ? (envelope as MeshMarkerEnvelope).from : from,
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
}

/**
 * Serialize a P2PMessage into the marker format for embedding in agent prompts.
 *
 * @param version  Output format version: "1" for legacy, "2" for v2 (default: "2")
 */
export function serializeToMarker(
  message: P2PMessage,
  version: "1" | "2" = "2"
): string {
  if (version === "1") {
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

  // v2 format — includes `from` and `mode` fields
  const envelope: MeshMarkerEnvelope = {
    version: "2.0",
    type: message.type,
    id: message.id,
    from: message.from,
    to: message.to,
    mode: "p2P",
    payload: message.payload,
    metadata: message.metadata,
  };
  return `${MESH_MARKER_V2_OPEN}${JSON.stringify(envelope)}${MESH_MARKER_CLOSE}`;
}

// ----------------------------------------------------------------------------
// Internal parsers
// ----------------------------------------------------------------------------

/**
 * Try to parse envelope content. When expectV2 is true, validate as
 * MeshMarkerEnvelope (v2); otherwise validate as MarkerEnvelope (v1).
 */
function tryParseEnvelope(
  content: string,
  expectV2: boolean
): MarkerEnvelope | MeshMarkerEnvelope | null {
  // Try JSON first (primary format)
  try {
    const obj = JSON.parse(content);
    if (expectV2 && isValidV2Envelope(obj)) {
      return obj as MeshMarkerEnvelope;
    }
    if (!expectV2 && isValidV1Envelope(obj)) {
      return obj as MarkerEnvelope;
    }
    // If version field is present, try to dispatch by version
    if (typeof obj === "object" && obj !== null) {
      const version = (obj as Record<string, unknown>).version;
      if (version === "2.0" && isValidV2Envelope(obj)) {
        return obj as MeshMarkerEnvelope;
      }
      if (version === "1.0" && isValidV1Envelope(obj)) {
        return obj as MarkerEnvelope;
      }
    }
  } catch {
    // Not JSON — try fallback key-value format (v1 only)
  }

  // Fallback: key: value per line (v1 only)
  if (!expectV2) {
    return parseKeyValueEnvelope(content);
  }

  return null;
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
// Type guards
// ----------------------------------------------------------------------------

function isValidV1Envelope(obj: unknown): obj is MarkerEnvelope {
  if (typeof obj !== "object" || obj === null) return false;
  const o = obj as Record<string, unknown>;
  return (
    typeof o.type === "string" &&
    typeof o.to === "string" &&
    o.payload !== undefined
  );
}

function isValidV2Envelope(obj: unknown): obj is MeshMarkerEnvelope {
  if (typeof obj !== "object" || obj === null) return false;
  const o = obj as Record<string, unknown>;
  return (
    typeof o.version === "string" &&
    o.version === "2.0" &&
    typeof o.type === "string" &&
    typeof o.from === "string" &&
    typeof o.to === "string" &&
    typeof o.mode === "string" &&
    o.payload !== undefined
  );
}

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
