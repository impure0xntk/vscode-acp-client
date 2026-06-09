import * as vscode from "vscode";
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

/**
 * VS Code implementation of the ACP Client interface.
 *
 * Implements the SDK `Client` interface, delegating each method to the
 * appropriate VS Code API. This class is connection-agnostic; it receives
 * an agentId via `setAgentId()` and routes events back to the Orchestrator.
 */
export class VscodeAcpClient implements Client {
  private agentId = "";

  constructor(
    private readonly onSessionUpdate: (
      agentId: string,
      notification: SessionNotification
    ) => void,
    private readonly onRequestPermission: (
      agentId: string,
      request: RequestPermissionRequest
    ) => Promise<RequestPermissionResponse>,
  ) {}

  setAgentId(id: string): void {
    this.agentId = id;
  }

  // ------------------------------------------------------------------
  // Client interface — required methods
  // ------------------------------------------------------------------

  async requestPermission(
    params: RequestPermissionRequest
  ): Promise<RequestPermissionResponse> {
    return this.onRequestPermission(this.agentId, params);
  }

  async sessionUpdate(params: SessionNotification): Promise<void> {
    this.onSessionUpdate(this.agentId, params);
  }

  // ------------------------------------------------------------------
  // Optional: filesystem
  // ------------------------------------------------------------------

  async readTextFile(
    params: ReadTextFileRequest
  ): Promise<ReadTextFileResponse> {
    const uri = vscode.Uri.file(params.path);
    const content = await vscode.workspace.fs.readFile(uri);
    return { content: new TextDecoder().decode(content) };
  }

  async writeTextFile(
    params: WriteTextFileRequest
  ): Promise<WriteTextFileResponse> {
    const uri = vscode.Uri.file(params.path);
    await vscode.workspace.fs.writeFile(
      uri,
      new TextEncoder().encode(params.content)
    );
    return {};
  }

  // ------------------------------------------------------------------
  // Optional: terminals (stub for Phase 1)
  // ------------------------------------------------------------------

  async createTerminal(
    params: CreateTerminalRequest
  ): Promise<CreateTerminalResponse> {
    const terminal = vscode.window.createTerminal({
      name: "ACP Terminal",
      cwd: params.cwd ?? undefined,
    });
    terminal.show();
    terminal.sendText(
      [params.command, ...(params.args ?? [])].join(" ")
    );
    const terminalId = `term-${Date.now()}`;
    // TODO: track terminalId → Terminal mapping
    return { terminalId };
  }

  async terminalOutput(
    params: TerminalOutputRequest
  ): Promise<TerminalOutputResponse> {
    // TODO: read from tracked terminal buffer
    return { output: "", truncated: false };
  }

  async releaseTerminal(
    _params: ReleaseTerminalRequest
  ): Promise<void> {
    // TODO: find terminal by ID and dispose
  }

  async waitForTerminalExit(
    _params: WaitForTerminalExitRequest
  ): Promise<WaitForTerminalExitResponse> {
    // TODO: wait for terminal close event
    return { exitCode: 0 };
  }

  async killTerminal(_params: KillTerminalRequest): Promise<void> {
    // TODO: send Ctrl+C or kill signal
  }
}
