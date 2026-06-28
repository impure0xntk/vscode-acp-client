import type { UIAPI } from "../../../platform/ui";

export class OutputChannelManager {
  private ui: UIAPI;
  private channels = new Map<
    string,
    ReturnType<UIAPI["createOutputChannel"]>
  >();

  constructor(ui: UIAPI) {
    this.ui = ui;
  }

  create(agentId: string) {
    const existing = this.channels.get(agentId);
    if (existing) return existing;
    const channel = this.ui.createOutputChannel(`ACP: ${agentId}`);
    this.channels.set(agentId, channel);
    return channel;
  }

  get(agentId: string) {
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
