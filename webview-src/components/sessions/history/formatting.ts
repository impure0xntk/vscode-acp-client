import type { ChatMessage } from "./DetailModal";

// ── Types ──────────────────────────────────────────────────────────────────

export interface PersistentSessionEntry {
  sessionId: string;
  agentId: string;
  title: string;
  cwd: string;
  model: string | null;
  mode: string | null;
  status: string;
  workspaceName: string | null;
  createdAt: string;
  updatedAt: string;
  lastResponseAt: string | null;
  messageCount: number;
  tokenUsage: { input: number; output: number; total: number };
  contextWindowMax: number | null;
  isArchived: boolean;
}

// ── groupByDate ─────────────────────────────────────────────────────────────

export function groupByDate(
  entries: PersistentSessionEntry[]
): Map<string, PersistentSessionEntry[]> {
  const now = new Date();
  const today = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate()
  ).getTime();
  const yesterday = today - 86400000;
  const weekAgo = today - 7 * 86400000;

  const groups = new Map<string, PersistentSessionEntry[]>();

  for (const entry of entries) {
    const t = new Date(entry.createdAt).getTime();
    let label: string;
    if (t >= today) label = "Today";
    else if (t >= yesterday) label = "Yesterday";
    else if (t >= weekAgo) label = "This Week";
    else label = "Older";

    const list = groups.get(label) ?? [];
    list.push(entry);
    groups.set(label, list);
  }

  return groups;
}

// ── exportAsJson ────────────────────────────────────────────────────────────

export function exportAsJson(
  sessions: PersistentSessionEntry[],
  messages: Map<string, ChatMessage[]>
): void {
  const data = sessions.map((s) => ({
    ...s,
    messages: messages.get(s.sessionId) ?? [],
  }));
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `session-history-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

// ── exportAsMarkdown ────────────────────────────────────────────────────────

export function exportAsMarkdown(
  sessions: PersistentSessionEntry[],
  messages: Map<string, ChatMessage[]>
): string {
  let md = `# Session History Export\n\n${new Date().toLocaleString()}\n\n---\n\n`;
  for (const s of sessions) {
    md += `## ${s.title}\n\n`;
    md += `- **Agent:** ${s.agentId}\n`;
    md += `- **Status:** ${s.status}\n`;
    md += `- **Model:** ${s.model ?? "unknown"}\n`;
    md += `- **Created:** ${s.createdAt}\n`;
    md += `- **Updated:** ${s.lastResponseAt ?? s.createdAt}\n`;
    md += `- **Messages:** ${s.messageCount}\n`;
    md += `- **Tokens:** ↑${s.tokenUsage.input} ↓${s.tokenUsage.output} (${s.tokenUsage.total} total)\n`;
    md += `- **CWD:** \`${s.cwd}\`\n\n`;
    const msgs = messages.get(s.sessionId) ?? [];
    for (const m of msgs) {
      md += `### ${m.role} — ${new Date(m.timestamp).toLocaleString()}\n\n`;
      md += `${m.content}\n\n`;
      if (m.inlineFilePaths?.length) {
        md += `> Inline files: ${m.inlineFilePaths.join(", ")}\n\n`;
      }
    }
    md += "---\n\n";
  }
  return md;
}
