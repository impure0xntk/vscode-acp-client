import React from "react";
import { createRoot } from "react-dom/client";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { AppContainer } from "./containers/AppContainer";
import { SessionContextProvider } from "./hooks/useSessionContext";
// CSS is built separately via esbuild.js postcss pipeline

const container = document.getElementById("root");
if (!container) {
  throw new Error("Root element not found");
}

const root = createRoot(container);
root.render(
  <React.StrictMode>
    <ErrorBoundary>
      <SessionContextProvider>
        <AppContainer />
      </SessionContextProvider>
    </ErrorBoundary>
  </React.StrictMode>
);
