// ============================================================================
// AgentConnection — agent process lifecycle and initialization
//
// Responsibilities:
//   - Spawn agent subprocess (child_process)
//   - Create ndJsonStream from process stdio
//   - Initialize ACP connection (handshake, capability exchange)
//   - Handle process exit/error → disconnect
//   - Store AgentInfo from InitializeResponse
// ============================================================================

import * as child_process from "child_process";
import { Readable, Writable } from "stream";
import {
  ClientSideConnection,
  ndJsonStream,
  PROTOCOL_VERSION,
  InitializeRequest,
  InitializeResponse,
} from "@agentclientprotocol/sdk";
import { PlatformAcpClient } from "../../adapter/acp/client";
import { getLogger } from "../../platform/backends";
import type { UIAPI } from "../../platform/ui";
import type { FileSystemAPI } from "../../platform/filesystem";
import type { AgentConfig } from "./types";
import type { AgentInfo } from "./types";

const log = getLogger("agent-connection");

// ============================================================================
// AgentConnection
// ============================================================================

export interface AgentConnectionDeps {
  ui: UIAPI;
  fs: FileSystemAPI;
  onSessionUpdate: (agentId: string, notification: import("@agentclientprotocol/sdk").SessionNotification) => void;
  onRequestPermission: (agentId: string, request: import("@agentclientprotocol/sdk").RequestPermissionRequest) => Promise<import("@agentclientprotocol/sdk").RequestPermissionResponse>;
  onAgentDisconnected: (agentId: string) => void;
  /** Called when the agent writes a file via ACP fs/write_text_file */
  onFileWrite: (event: import("../../adapter/acp/client").FileWriteEvent) => void;
}

export class AgentConnection {
  // agentId → ClientSideConnection
  private connections: Map<string, ClientSideConnection> = new Map();
  // agentId → child process
  private processes: Map<string, child_process.ChildProcess> = new Map();
  // agentId → AgentInfo
  private agentInfoMap: Map<string, AgentInfo> = new Map();
  // agentId → AgentConfig
  private agentConfigs: Map<string, AgentConfig> = new Map();

  private deps: AgentConnectionDeps;

  constructor(deps: AgentConnectionDeps) {
    this.deps = deps;
  }

  // ========================================================================
    // Connection
    // ========================================================================

  async connect(agentId: string, config: AgentConfig): Promise<InitializeResponse> {
    if (this.connections.has(agentId)) {
      throw new Error(`Agent ${agentId} already connected`);
    }

    this.agentConfigs.set(agentId, config);

    const proc = child_process.spawn(config.command, config.args ?? [], {
      env: { ...process.env, ...config.env },
      cwd: process.cwd(),
      stdio: ["pipe", "pipe", "pipe"],
    });

    log.debug("agent process spawned", { agentId, pid: proc.pid });
    this.processes.set(agentId, proc);

    const stdinWritable = Writable.toWeb(
      proc.stdin
    ) as WritableStream<Uint8Array>;
    const stdoutReadable = Readable.toWeb(
      proc.stdout
    ) as ReadableStream<Uint8Array>;
    const stream = ndJsonStream(stdinWritable, stdoutReadable);

    const client = new PlatformAcpClient(
      { fs: this.deps.fs, ui: this.deps.ui },
      (aId, notification) => this.deps.onSessionUpdate(aId, notification),
      (aId, request) => this.deps.onRequestPermission(aId, request),
      (event) => this.deps.onFileWrite(event)
    );
    client.setAgentId(agentId);

    const connection = new ClientSideConnection(() => client, stream);
    this.connections.set(agentId, connection);

    proc.on("close", (code) => {
      log.info("agent process exited", { agentId, exitCode: code });
      this.handleDisconnected(agentId);
    });
    proc.on("error", (err) => {
      log.error("agent process error", { agentId }, err);
    });

    log.debug("sending initialize", {
      agentId,
      protocolVersion: PROTOCOL_VERSION,
    });
    const initResponse = await connection.initialize({
      protocolVersion: PROTOCOL_VERSION,
      clientCapabilities: {
        fs: { readTextFile: true, writeTextFile: true },
      },
    } satisfies InitializeRequest);

    if (!initResponse) {
      throw new Error("Failed to initialize agent connection");
    }

    this.storeAgentInfo(agentId, initResponse);

    log.info("agent connected", {
      agentId,
      name: initResponse.agentInfo?.name,
      version: initResponse.agentInfo?.version,
      protocolVersion: initResponse.protocolVersion,
      loadSession: initResponse.agentCapabilities?.loadSession ?? false,
    });

    return initResponse;
  }

  async disconnect(agentId: string): Promise<void> {
    const connection = this.connections.get(agentId);
    if (!connection) return;

    this.connections.delete(agentId);

    const proc = this.processes.get(agentId);
    if (proc) {
      proc.kill();
      this.processes.delete(agentId);
      log.debug("agent process killed", { agentId, pid: proc.pid });
    }

    this.agentInfoMap.delete(agentId);
    this.agentConfigs.delete(agentId);

    log.info("agent disconnected", { agentId });
  }

  // ========================================================================
  // Agent Info
  // ========================================================================

  private storeAgentInfo(agentId: string, response: InitializeResponse): void {
    const sc = response.agentCapabilities?.sessionCapabilities;
    this.agentInfoMap.set(agentId, {
      name: response.agentInfo?.name ?? agentId,
      title: response.agentInfo?.title ?? undefined,
      version: response.agentInfo?.version ?? undefined,
      protocolVersion: response.protocolVersion,
      capabilities: response.agentCapabilities
        ? {
            loadSession: response.agentCapabilities.loadSession ?? false,
            promptCapabilities: response.agentCapabilities
              .promptCapabilities
              ? {
                  image:
                    response.agentCapabilities.promptCapabilities.image ??
                    false,
                  audio:
                    response.agentCapabilities.promptCapabilities.audio ??
                    false,
                  embeddedContext:
                    response.agentCapabilities.promptCapabilities
                      .embeddedContext ?? false,
                }
              : undefined,
            sessionCapabilities: sc
              ? {
                  fork: sc.fork != null,
                  list: sc.list != null,
                  resume: sc.resume != null,
                  delete: sc.delete != null,
                  close: sc.close != null,
                  additionalDirectories: sc.additionalDirectories != null,
                }
              : undefined,
          }
        : undefined,
    });
  }

  getAgentInfo(agentId: string): AgentInfo | undefined {
    return this.agentInfoMap.get(agentId);
  }

  getAgentConfig(agentId: string): AgentConfig | undefined {
    return this.agentConfigs.get(agentId);
  }

  getConnection(agentId: string): ClientSideConnection | undefined {
    return this.connections.get(agentId);
  }

  isConnected(agentId: string): boolean {
    return this.connections.has(agentId);
  }

  getAgentIds(): string[] {
    return Array.from(this.agentConfigs.keys());
  }

  getProcess(agentId: string): child_process.ChildProcess | undefined {
    return this.processes.get(agentId);
  }

  // ========================================================================
    // Lifecycle
    // ========================================================================

  private handleDisconnected(agentId: string): void {
    this.connections.delete(agentId);
    this.processes.delete(agentId);
    this.agentInfoMap.delete(agentId);
    this.deps.onAgentDisconnected(agentId);
  }

  dispose(): void {
    for (const [, proc] of this.processes) {
      proc.kill();
    }
    this.connections.clear();
    this.processes.clear();
    this.agentInfoMap.clear();
    this.agentConfigs.clear();
  }
}
