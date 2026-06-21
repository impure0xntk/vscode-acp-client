export type SortField = "createdAt" | "messageCount" | "tokenUsage" | "title";
export type SortDir = "asc" | "desc";

export function SearchBar({
  query,
  onQueryChange,
  selectedAgent,
  agents,
  onAgentChange,
  sortField,
  sortDir,
  onSortChange,
}: {
  query: string;
  onQueryChange: (q: string) => void;
  selectedAgent: string;
  agents: string[];
  onAgentChange: (agent: string) => void;
  sortField: SortField;
  sortDir: SortDir;
  onSortChange: (field: SortField, dir: SortDir) => void;
}): React.ReactElement {
  return (
    <div className="flex items-center gap-1.5 px-2.5 py-[6px] border-b border-border shrink-0">
      <input
        className="flex-1 min-w-0 px-2 py-[3px] border border-border rounded bg-bg-input text-fg-primary text-xs outline-none focus:border-accent"
        type="text"
        placeholder="Search sessions..."
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
      />
      <select
        className="px-1.5 py-[3px] border border-border rounded bg-bg-input text-fg-primary text-xs outline-none focus:border-accent"
        value={selectedAgent}
        onChange={(e) => onAgentChange(e.target.value)}
      >
        {agents.map((a) => (
          <option key={a} value={a}>
            {a === "all" ? "All agents" : a}
          </option>
        ))}
      </select>
      <div className="flex items-center gap-0.5 shrink-0">
        <select
          className="px-1.5 py-[3px] border border-border rounded bg-bg-input text-fg-primary text-xs outline-none"
          value={sortField}
          onChange={(e) => onSortChange(e.target.value as SortField, sortDir)}
        >
          <option value="createdAt">Date</option>
          <option value="messageCount">Messages</option>
          <option value="tokenUsage">Tokens</option>
          <option value="title">Title</option>
        </select>
        <button
          className="flex items-center justify-center w-6 h-[22px] p-0 border border-border rounded bg-bg-input text-fg-primary text-base cursor-pointer transition-colors duration-150 hover:bg-accent-hover"
          onClick={() =>
            onSortChange(sortField, sortDir === "asc" ? "desc" : "asc")
          }
          title={sortDir === "asc" ? "Ascending" : "Descending"}
        >
          {sortDir === "asc" ? "↑" : "↓"}
        </button>
      </div>
    </div>
  );
}
