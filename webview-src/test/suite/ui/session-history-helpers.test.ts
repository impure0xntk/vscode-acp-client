import * as assert from "assert";
import { describe, it } from "mocha";

// ── Pure functions from SessionHistory ─────────────────────────────────────

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function contextUsagePct(usage: number, max: number | null): number {
  if (!max || max <= 0) return 0;
  return Math.min(100, Math.round((usage / max) * 100));
}

function groupByDate(
  entries: Array<{ createdAt: string }>
): Map<string, Array<{ createdAt: string }>> {
  const now = new Date();
  const today = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate()
  ).getTime();
  const yesterday = today - 86400000;
  const weekAgo = today - 7 * 86400000;

  const groups = new Map<string, Array<{ createdAt: string }>>();

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

function exportAsMarkdown(
  sessions: Array<{
    title: string;
    agentId: string;
    status: string;
    model: string | null;
    createdAt: string;
    lastResponseAt: string | null;
    messageCount: number;
    tokenUsage: { input: number; output: number; total: number };
    cwd: string;
  }>,
  messages: Map<
    string,
    Array<{
      role: string;
      content: string;
      timestamp: number;
      inlineFilePaths?: string[];
    }>
  >
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
    const msgs = messages.get(s.title) ?? [];
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

// ── formatTokens ────────────────────────────────────────────────────────────

describe("formatTokens (SessionHistory)", () => {
  it("returns plain number for < 1000", () => {
    assert.strictEqual(formatTokens(0), "0");
    assert.strictEqual(formatTokens(999), "999");
  });

  it("formats thousands with 'k'", () => {
    assert.strictEqual(formatTokens(1000), "1.0k");
    assert.strictEqual(formatTokens(1500), "1.5k");
  });

  it("formats millions with 'M'", () => {
    assert.strictEqual(formatTokens(1_000_000), "1.0M");
    assert.strictEqual(formatTokens(2_500_000), "2.5M");
  });
});

// ── contextUsagePct ─────────────────────────────────────────────────────────

describe("contextUsagePct", () => {
  it("returns 0 when max is null", () => {
    assert.strictEqual(contextUsagePct(500, null), 0);
  });

  it("returns 0 when max is 0", () => {
    assert.strictEqual(contextUsagePct(500, 0), 0);
  });

  it("returns 0 when max is negative", () => {
    assert.strictEqual(contextUsagePct(500, -100), 0);
  });

  it("calculates percentage correctly", () => {
    assert.strictEqual(contextUsagePct(500, 1000), 50);
    assert.strictEqual(contextUsagePct(750, 1000), 75);
  });

  it("caps at 100", () => {
    assert.strictEqual(contextUsagePct(1500, 1000), 100);
  });

  it("rounds to nearest integer", () => {
    assert.strictEqual(contextUsagePct(333, 1000), 33);
    assert.strictEqual(contextUsagePct(666, 1000), 67);
  });
});

// ── groupByDate ─────────────────────────────────────────────────────────────

describe("groupByDate", () => {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 86400000);
  const twoDaysAgo = new Date(today.getTime() - 2 * 86400000);
  const eightDaysAgo = new Date(today.getTime() - 8 * 86400000);

  it("groups today's entries", () => {
    const entries = [{ createdAt: today.toISOString() }];
    const groups = groupByDate(entries);
    assert.ok(groups.has("Today"));
    assert.strictEqual(groups.get("Today")!.length, 1);
  });

  it("groups yesterday's entries", () => {
    const entries = [{ createdAt: yesterday.toISOString() }];
    const groups = groupByDate(entries);
    assert.ok(groups.has("Yesterday"));
    assert.strictEqual(groups.get("Yesterday")!.length, 1);
  });

  it("groups entries from 2 days ago as 'This Week'", () => {
    const entries = [{ createdAt: twoDaysAgo.toISOString() }];
    const groups = groupByDate(entries);
    assert.ok(groups.has("This Week"));
  });

  it("groups entries from 8 days ago as 'Older'", () => {
    const entries = [{ createdAt: eightDaysAgo.toISOString() }];
    const groups = groupByDate(entries);
    assert.ok(groups.has("Older"));
  });

  it("groups multiple entries into correct buckets", () => {
    const entries = [
      { createdAt: today.toISOString() },
      { createdAt: yesterday.toISOString() },
      { createdAt: eightDaysAgo.toISOString() },
    ];
    const groups = groupByDate(entries);
    assert.strictEqual(groups.get("Today")!.length, 1);
    assert.strictEqual(groups.get("Yesterday")!.length, 1);
    assert.strictEqual(groups.get("Older")!.length, 1);
  });

  it("returns empty map for empty input", () => {
    const groups = groupByDate([]);
    assert.strictEqual(groups.size, 0);
  });
});

// ── exportAsMarkdown ────────────────────────────────────────────────────────

describe("exportAsMarkdown", () => {
  it("generates markdown with session title", () => {
    const sessions = [
      {
        title: "My Session",
        agentId: "claude",
        status: "completed",
        model: "claude-3",
        createdAt: "2026-01-15T10:00:00Z",
        lastResponseAt: "2026-01-15T11:00:00Z",
        messageCount: 5,
        tokenUsage: { input: 1000, output: 500, total: 1500 },
        cwd: "/workspace",
      },
    ];
    const md = exportAsMarkdown(sessions, new Map());
    assert.ok(md.includes("## My Session"));
    assert.ok(md.includes("**Agent:** claude"));
    assert.ok(md.includes("**Status:** completed"));
    assert.ok(md.includes("**Model:** claude-3"));
    assert.ok(md.includes("**Messages:** 5"));
    assert.ok(md.includes("↑1000 ↓500 (1500 total)"));
    assert.ok(md.includes("`/workspace`"));
  });

  it("uses 'unknown' for null model", () => {
    const sessions = [
      {
        title: "Test",
        agentId: "agent1",
        status: "idle",
        model: null,
        createdAt: "2026-01-15T10:00:00Z",
        lastResponseAt: null,
        messageCount: 0,
        tokenUsage: { input: 0, output: 0, total: 0 },
        cwd: "/tmp",
      },
    ];
    const md = exportAsMarkdown(sessions, new Map());
    assert.ok(md.includes("**Model:** unknown"));
  });

  it("falls back to createdAt when lastResponseAt is null", () => {
    const sessions = [
      {
        title: "Test",
        agentId: "agent1",
        status: "idle",
        model: "gpt-4",
        createdAt: "2026-01-15T10:00:00Z",
        lastResponseAt: null,
        messageCount: 0,
        tokenUsage: { input: 0, output: 0, total: 0 },
        cwd: "/tmp",
      },
    ];
    const md = exportAsMarkdown(sessions, new Map());
    assert.ok(md.includes("- **Updated:** 2026-01-15T10:00:00Z"));
  });

  it("includes messages when provided", () => {
    const sessions = [
      {
        title: "Test",
        agentId: "agent1",
        status: "completed",
        model: "claude-3",
        createdAt: "2026-01-15T10:00:00Z",
        lastResponseAt: "2026-01-15T11:00:00Z",
        messageCount: 1,
        tokenUsage: { input: 100, output: 50, total: 150 },
        cwd: "/workspace",
      },
    ];
    const messages = new Map([
      ["Test", [{ role: "user", content: "Hello", timestamp: 1705312800000 }]],
    ]);
    const md = exportAsMarkdown(sessions, messages);
    assert.ok(md.includes("### user"));
    assert.ok(md.includes("Hello"));
  });

  it("includes inline file paths when present", () => {
    const sessions = [
      {
        title: "Test",
        agentId: "agent1",
        status: "completed",
        model: "claude-3",
        createdAt: "2026-01-15T10:00:00Z",
        lastResponseAt: "2026-01-15T11:00:00Z",
        messageCount: 1,
        tokenUsage: { input: 100, output: 50, total: 150 },
        cwd: "/workspace",
      },
    ];
    const messages = new Map([
      [
        "Test",
        [
          {
            role: "agent",
            content: "Done",
            timestamp: 1705312800000,
            inlineFilePaths: ["src/main.ts", "src/utils.ts"],
          },
        ],
      ],
    ]);
    const md = exportAsMarkdown(sessions, messages);
    assert.ok(md.includes("src/main.ts"));
    assert.ok(md.includes("src/utils.ts"));
  });

  it("handles multiple sessions", () => {
    const sessions = [
      {
        title: "Session A",
        agentId: "claude",
        status: "completed",
        model: "claude-3",
        createdAt: "2026-01-15T10:00:00Z",
        lastResponseAt: null,
        messageCount: 3,
        tokenUsage: { input: 100, output: 50, total: 150 },
        cwd: "/a",
      },
      {
        title: "Session B",
        agentId: "gpt4",
        status: "running",
        model: "gpt-4",
        createdAt: "2026-01-14T10:00:00Z",
        lastResponseAt: null,
        messageCount: 10,
        tokenUsage: { input: 5000, output: 2000, total: 7000 },
        cwd: "/b",
      },
    ];
    const md = exportAsMarkdown(sessions, new Map());
    assert.ok(md.includes("## Session A"));
    assert.ok(md.includes("## Session B"));
    assert.ok(md.includes("**Agent:** claude"));
    assert.ok(md.includes("**Agent:** gpt4"));
  });
});
