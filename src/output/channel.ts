import * as vscode from "vscode";

// ============================================================================
// Output Channel Manager — per-agent output channels
// ============================================================================

export class OutputChannelManager {
  private channels = new Map<string, vscode.OutputChannel>();

  create(agentId: string): vscode.OutputChannel {
    const existing = this.channels.get(agentId);
    if (existing) return existing;
    const channel = vscode.window.createOutputChannel(`ACP: ${agentId}`);
    this.channels.set(agentId, channel);
    return channel;
  }

  get(agentId: string): vscode.OutputChannel | undefined {
    return this.channels.get(agentId);
  }

  show(agentId: string): void {
    const ch = this.channels.get(agentId);
    if (ch) ch.show();
  }

  appendLine(agentId: string, message: string): void {
    const ch = this.channels.get(agentId);
    if (ch) ch.appendLine(message);
  }

  dispose(): void {
    for (const ch of this.channels.values()) {
      ch.dispose();
    }
    this.channels.clear();
  }
}
