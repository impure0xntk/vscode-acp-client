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
import { getLogger } from "../../platform/backends";
import type { FileSystemAPI } from "../../platform/filesystem";
import type { UIAPI, QuickPickItem } from "../../platform/ui";

const log = getLogger("protocol");

export interface AcpClientDeps {
  fs: FileSystemAPI;
  ui: UIAPI;
}

/**
 * ACP Client implementation using Platform API.
 */
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
    ) => Promise<RequestPermissionResponse>
  ) {
    this.deps = deps;
  }

  setAgentId(id: string): void {
    this.agentId = id;
  }

  async requestPermission(
    params: RequestPermissionRequest
  ): Promise<RequestPermissionResponse> {
    const tc = params.toolCall as { kind?: string; rawInput?: unknown } | undefined;
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
    const content = await this.deps.fs.readFile(params.path);
    return { content };
  }

  async writeTextFile(
    params: WriteTextFileRequest
  ): Promise<WriteTextFileResponse> {
    log.info("writeTextFile", {
      agentId: this.agentId,
      path: params.path,
      contentLen: params.content.length,
    });
    await this.deps.fs.writeFile(params.path, params.content);
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
    log.debug("releaseTerminal", { agentId: this.agentId, terminalId: params.terminalId });
  }

  async waitForTerminalExit(
    params: WaitForTerminalExitRequest
  ): Promise<WaitForTerminalExitResponse> {
    return { exitCode: 0 };
  }

  async killTerminal(params: KillTerminalRequest): Promise<void> {
    log.info("killTerminal", { agentId: this.agentId, terminalId: params.terminalId });
  }
}

/**
 * VSCode-specific client that uses VSCode QuickPick for permission requests.
 */
