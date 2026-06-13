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
import type { FileSystemAPI } from "../../platform/filesystem";
import type { UIAPI, QuickPickItem } from "../../platform/ui";

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
    return this.onRequestPermission(this.agentId, params);
  }

  async sessionUpdate(params: SessionNotification): Promise<void> {
    this.onSessionUpdate(this.agentId, params);
  }

  async readTextFile(
    params: ReadTextFileRequest
  ): Promise<ReadTextFileResponse> {
    const content = await this.deps.fs.readFile(params.path);
    return { content };
  }

  async writeTextFile(
    params: WriteTextFileRequest
  ): Promise<WriteTextFileResponse> {
    await this.deps.fs.writeFile(params.path, params.content);
    return {};
  }

  async createTerminal(
    params: CreateTerminalRequest
  ): Promise<CreateTerminalResponse> {
    const terminal = this.deps.ui.createOutputChannel("ACP Terminal");
    return { terminalId: `term-${Date.now()}` };
  }

  async terminalOutput(
    params: TerminalOutputRequest
  ): Promise<TerminalOutputResponse> {
    return { output: "", truncated: false };
  }

  async releaseTerminal(_params: ReleaseTerminalRequest): Promise<void> {}

  async waitForTerminalExit(
    _params: WaitForTerminalExitRequest
  ): Promise<WaitForTerminalExitResponse> {
    return { exitCode: 0 };
  }

  async killTerminal(_params: KillTerminalRequest): Promise<void> {}
}

/**
 * VSCode-specific client that uses VSCode QuickPick for permission requests.
 */
