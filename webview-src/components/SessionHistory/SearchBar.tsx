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
    <div className="history-toolbar">
      <input
        className="history-search-input"
        type="text"
        placeholder="Search sessions..."
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
      />
      <select
        className="history-agent-filter"
        value={selectedAgent}
        onChange={(e) => onAgentChange(e.target.value)}
      >
        {agents.map((a) => (
          <option key={a} value={a}>
            {a === "all" ? "All agents" : a}
          </option>
        ))}
      </select>
      <div className="history-sort">
        <select
          className="history-sort-select"
          value={sortField}
          onChange={(e) => onSortChange(e.target.value as SortField, sortDir)}
        >
          <option value="createdAt">Date</option>
          <option value="messageCount">Messages</option>
          <option value="tokenUsage">Tokens</option>
          <option value="title">Title</option>
        </select>
        <button
          className="history-sort-dir"
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
