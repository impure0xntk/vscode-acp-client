import type {
  Client,
  RequestPermissionRequest,
  RequestPermissionResponse,
  SessionNotification,
  ReadTextFileRequest,
  ReadTextFileResponse,
  WriteTextFileRequest,
  WriteTextFileResponse,
  CreateTerminalRequest,
  CreateTerminalResponse,
  TerminalOutputRequest,
  TerminalOutputResponse,
  ReleaseTerminalRequest,
  WaitForTerminalExitRequest,
  WaitForTerminalExitResponse,
  KillTerminalRequest,
} from "@agentclientprotocol/sdk";
import { createHash } from "node:crypto";
import { getLogger } from "../../platform/backends";
import type { FileSystemAPI } from "../../platform/filesystem";
import type { UIAPI, QuickPickItem } from "../../platform/ui";

const log = getLogger("protocol");

/**
 * Event emitted when the agent writes a file via ACP fs/write_text_file.
 * Contains the file path and content for line counting.
 */
export interface FileWriteEvent {
  agentId: string;
  sessionId: string;
  path: string;
  content: string;
  originalContent: string | null;
  contentHash: string;
}

export function computeContentHash(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

export interface AcpClientDeps {
  fs: FileSystemAPI;
  ui: UIAPI;
}

export class PlatformAcpClient implements Client {
  private agentId = "";
  private deps: AcpClientDeps;

  constructor(
    deps: AcpClientDeps,
    private readonly onSessionUpdate: (
      agentId: string,
      notification: SessionNotification
    ) => void,
    private readonly onRequestPermission: (
      agentId: string,
      request: RequestPermissionRequest
    ) => Promise<RequestPermissionResponse>,
    private readonly onFileWrite?: (event: FileWriteEvent) => void
  ) {
    this.deps = deps;
  }

  setAgentId(id: string): void {
    this.agentId = id;
  }

  async requestPermission(
    params: RequestPermissionRequest
  ): Promise<RequestPermissionResponse> {
    const tc = params.toolCall as
      | { kind?: string; rawInput?: unknown }
      | undefined;
    log.debug("requestPermission", {
      agentId: this.agentId,
      toolKind: tc?.kind,
      rawInput: tc?.rawInput,
      options: params.options?.length ?? 0,
    });
    const result = await this.onRequestPermission(this.agentId, params);
    log.debug("requestPermission result", {
      agentId: this.agentId,
      outcome: result.outcome,
    });
    return result;
  }

  async sessionUpdate(params: SessionNotification): Promise<void> {
    const updateKind = Object.keys(params.update ?? {}).join(",");
    log.trace("sessionUpdate", { agentId: this.agentId, updateKind });
    this.onSessionUpdate(this.agentId, params);
  }

  async readTextFile(
    params: ReadTextFileRequest
  ): Promise<ReadTextFileResponse> {
    log.debug("readTextFile", { agentId: this.agentId, path: params.path });
    try {
      const content = await this.deps.fs.readFile(params.path);
      return { content };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log.warn("readTextFile failed", {
        agentId: this.agentId,
        path: params.path,
        error: msg,
      });
      return { content: "" };
    }
  }

  async writeTextFile(
    params: WriteTextFileRequest
  ): Promise<WriteTextFileResponse> {
    log.info("writeTextFile", {
      agentId: this.agentId,
      path: params.path,
      contentLen: params.content.length,
    });
    let originalContent: string | null = null;
    try {
      originalContent = await this.deps.fs.readFile(params.path);
    } catch {
    }
    await this.deps.fs.writeFile(params.path, params.content);
    this.onFileWrite?.({
      agentId: this.agentId,
      sessionId: params.sessionId,
      path: params.path,
      content: params.content,
      originalContent,
      contentHash: computeContentHash(params.content),
    });
    return {};
  }

  async createTerminal(
    params: CreateTerminalRequest
  ): Promise<CreateTerminalResponse> {
    log.info("createTerminal", {
      agentId: this.agentId,
      command: params.command,
      cwd: params.cwd,
    });
    const terminal = this.deps.ui.createOutputChannel("ACP Terminal");
    return { terminalId: `term-${Date.now()}` };
  }

  async terminalOutput(
    params: TerminalOutputRequest
  ): Promise<TerminalOutputResponse> {
    return { output: "", truncated: false };
  }

  async releaseTerminal(params: ReleaseTerminalRequest): Promise<void> {
    log.debug("releaseTerminal", {
      agentId: this.agentId,
      terminalId: params.terminalId,
    });
  }

  async waitForTerminalExit(
    params: WaitForTerminalExitRequest
  ): Promise<WaitForTerminalExitResponse> {
    return { exitCode: 0 };
  }

  async killTerminal(params: KillTerminalRequest): Promise<void> {
    log.info("killTerminal", {
      agentId: this.agentId,
      terminalId: params.terminalId,
    });
  }
}


