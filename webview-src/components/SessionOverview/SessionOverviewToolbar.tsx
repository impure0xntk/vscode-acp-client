import React from "react";
import type { SessionOverviewFilter } from "../../types";

interface Props {
  filter: SessionOverviewFilter;
  sessionCount: number;
  onFilterChange: (filter: SessionOverviewFilter) => void;
}

export function SessionOverviewToolbar({
  filter,
  sessionCount,
  onFilterChange,
}: Props): React.ReactElement {
  return (
    <div className="session-overview-toolbar">
      <span className="session-overview-toolbar-title">
        Session Overview
      </span>
      <span className="session-overview-toolbar-count">{sessionCount}</span>
      <div className="session-overview-toolbar-filters">
        <button
          className={`session-overview-filter-btn${filter === "all" ? " active" : ""}`}
          onClick={() => onFilterChange("all")}
        >
          All
        </button>
        <button
          className={`session-overview-filter-btn${filter === "active" ? " active" : ""}`}
          onClick={() => onFilterChange("active")}
        >
          Active
        </button>
      </div>
    </div>
  );
}
