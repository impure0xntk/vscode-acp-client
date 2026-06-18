import React from "react";
import { createRoot } from "react-dom/client";
import { ErrorBoundary } from "./components/primitives/ErrorBoundary";
import { AppContainer } from "./containers/AppContainer";
import { setupMessageHandlers } from "./webviewMessageHandler";
// CSS is built separately via esbuild.js postcss pipeline

const container = document.getElementById("root");
if (!container) {
  throw new Error("Root element not found");
}

// Setup message handlers before React renders so early messages are not lost.
// This must be called before root.render() so the listener is ready for
// the initial setTabs / sessionOverview:state messages from the extension host.
setupMessageHandlers();

const root = createRoot(container);
root.render(
  <React.StrictMode>
    <ErrorBoundary>
      <AppContainer />
    </ErrorBoundary>
  </React.StrictMode>
);
