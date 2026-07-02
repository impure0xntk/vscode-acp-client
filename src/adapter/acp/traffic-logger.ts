/**
 * Protocol traffic logger
 *
 * Records JSON-RPC message sends and receives on the ACP stdio transport
 * with timestamps. Integrated with the existing `acp.logTraffic` setting.
 */

import { getLogger } from "../../platform/backends";

const log = getLogger("protocol");

/**
 * A single traffic log entry
 */
export interface TrafficLogEntry {
  /** Monotonically increasing sequence number (starts at 1) */
  seq: number;
  /** Epoch milliseconds */
  timestamp: number;
  /** send or receive */
  direction: "send" | "receive";
  /** Raw NDJSON line string */
  line: string;
  /** Parsed message (present only on successful parse) */
  parsed?: unknown;
}

/**
 * Traffic logger
 *
 * Holds sent/received lines in a ring buffer.
 * Default buffer size is 1000 entries.
 */
export class TrafficLogger {
  private entries: TrafficLogEntry[] = [];
  private seq = 0;
  private readonly maxEntries: number;
  private readonly enabled: boolean;

  constructor(maxEntries = 1000, enabled = true) {
    this.maxEntries = maxEntries;
    this.enabled = enabled;
  }

  /**
   * Log an outgoing message.
   *
   * @param line sent NDJSON line
   */
  logSend(line: string): void {
    if (!this.enabled) return;
    this.append("send", line);
  }

  /**
   * Log an incoming message.
   *
   * @param line received NDJSON line
   */
  logReceive(line: string): void {
    if (!this.enabled) return;
    this.append("receive", line);
  }

  /**
   * Return all entries.
   */
  getEntries(): readonly TrafficLogEntry[] {
    return this.entries;
  }

  /**
   * Return the entry count.
   */
  getEntryCount(): number {
    return this.entries.length;
  }

  /**
   * Clear all entries.
   */
  clear(): void {
    this.entries = [];
    this.seq = 0;
  }

  /**
   * Enable or disable logging.
   */
  setEnabled(enabled: boolean): void {
    // enabled is readonly, but we allow mutation internally
    (this as unknown as { enabled: boolean }).enabled = enabled;
    log.info(`Traffic logging ${enabled ? "enabled" : "disabled"}`);
  }

  private append(direction: "send" | "receive", line: string): void {
    this.seq += 1;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      // Leave parsed undefined on parse failure
    }
    const entry: TrafficLogEntry = {
      seq: this.seq,
      timestamp: Date.now(),
      direction,
      line,
      parsed,
    };
    this.entries.push(entry);
    // Ring buffer behavior: evict oldest entries when over capacity
    if (this.entries.length > this.maxEntries) {
      const removeCount = this.entries.length - this.maxEntries;
      this.entries.splice(0, removeCount);
    }
  }
}
