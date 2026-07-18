import { MessageRouter } from "./MessageRouter";
import { setupAllHandlers } from "./handlers/register";
import { getVsCodeApi } from "../lib/vscodeApi";

/**
 * Set up all message handlers on the router and notify the extension host
 * that the webview is ready.
 */
export function setupDefaultRoutes(router: MessageRouter): void {
  setupAllHandlers(router);

  // Install on window
  window.addEventListener("message", router.onWindowMessage);

  // Notify extension host that webview is ready
  getVsCodeApi().postMessage({ type: "ready" });
  getVsCodeApi().postMessage({ type: "sessionReady" });
  getVsCodeApi().postMessage({ type: "mesh:getStatus" });
}
