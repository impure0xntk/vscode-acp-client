import * as vscode from "vscode";

// ============================================================================
// Status Bar Manager
// ============================================================================

export class AgentStatusBar {
  private statusBarItem: vscode.StatusBarItem;
  private connected = false;
  private activeAgentName: string | null = null;

  constructor() {
    this.statusBarItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      100
    );
    this.statusBarItem.command = "acp.showAgentMenu";
    this.update();
    this.statusBarItem.show();
  }

  // ========================================================================
  // State Updates
  // ========================================================================

  setConnected(connected: boolean, agentName?: string): void {
    this.connected = connected;
    this.activeAgentName = agentName ?? this.activeAgentName;
    this.update();
  }

  setAgentName(name: string): void {
    this.activeAgentName = name;
    this.update();
  }

  // ========================================================================
  // Internal
  // ========================================================================

  private update(): void {
    if (this.connected && this.activeAgentName) {
      this.statusBarItem.text = "$(hubot) ACP: " + this.activeAgentName;
      this.statusBarItem.tooltip = `Connected to ${this.activeAgentName} via ACP`;
    } else {
      this.statusBarItem.text = "$(circle-slash) ACP";
      this.statusBarItem.tooltip = "ACP: Not connected";
    }
  }

  // ========================================================================
  // Lifecycle
  // ========================================================================

  dispose(): void {
    this.statusBarItem.dispose();
  }
}
