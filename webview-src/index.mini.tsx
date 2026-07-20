import React from "react";
import { createRoot } from "react-dom/client";
import { ErrorBoundary } from "./components/primitives/ErrorBoundary";
import { MiniChatContainer } from "./containers/MiniChatContainer";
import { setupDefaultRoutes } from "./messageRouter/setupDefaultRoutes";
import { MessageRouter } from "./messageRouter/MessageRouter";
// CSS is built separately via esbuild.js postcss pipeline

const container = document.getElementById("root");
if (!container) {
  throw new Error("Root element not found");
}

// Setup message handlers before React renders so early messages are not lost.
setupDefaultRoutes(new MessageRouter());

const root = createRoot(container);
root.render(
  <React.StrictMode>
    <ErrorBoundary>
      <MiniChatContainer />
    </ErrorBoundary>
  </React.StrictMode>
);
