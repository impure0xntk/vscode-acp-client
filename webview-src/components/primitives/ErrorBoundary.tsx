import React, { Component } from "react";

interface ErrorBoundaryState {
  error: Error | null;
}

export class ErrorBoundary extends Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div
          style={{
            padding: 16,
            color: "#f14c4c",
            fontFamily: "monospace",
            fontSize: 13,
          }}
        >
          <div style={{ fontWeight: 700, marginBottom: 8 }}>ACP Chat Error</div>
          <pre style={{ whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
            {this.state.error.message}
            {"\n\n"}
            {this.state.error.stack}
          </pre>
        </div>
      );
    }
    return this.props.children;
  }
}
