"use client";

import { useEffect } from "react";

/**
 * Initialize mermaid.js on app mount.
 * This component has no visual output - it just runs the initialization side effect.
 */
export function MermaidInitializer(): null {
  useEffect(() => {
    const initMermaid = async () => {
      try {
        const mermaid = await import("mermaid");
        const m = mermaid.default;

        // Configure mermaid with VS Code theme-aware settings
        m.initialize({
          startOnLoad: false,
          theme: "base",
          themeVariables: {
            primaryColor: "var(--vscode-focusBorder, #007acc)",
            primaryTextColor: "var(--vscode-editor-foreground, #d4d4d4)",
            primaryBorderColor: "var(--vscode-panel-border, #333)",
            lineColor: "var(--vscode-panel-border, #333)",
            secondaryColor: "var(--vscode-sideBar-background, #252526)",
            tertiaryColor: "var(--vscode-editor-background, #1e1e1e)",
            background: "var(--vscode-editor-background, #1e1e1e)",
            mainBkg: "var(--vscode-editor-background, #1e1e1e)",
            secondBkg: "var(--vscode-sideBar-background, #252526)",
            tertiaryBkg: "var(--vscode-input-background, #3c3c3c)",
            textColor: "var(--vscode-editor-foreground, #d4d4d4)",
            nodeBorder: "var(--vscode-panel-border, #333)",
            clusterBorder: "var(--vscode-panel-border, #333)",
            edgeLabelBackground: "var(--vscode-editor-background, #1e1e1e)",
          },
          securityLevel: "loose",
          fontFamily:
            'var(--vscode-editor-font-family, "JetBrains Mono", "Fira Code", monospace)',
          flowchart: {
            useMaxWidth: true,
            htmlLabels: true,
            curve: "basis",
          },
          sequence: {
            useMaxWidth: true,
            diagramMarginX: 50,
            diagramMarginY: 10,
            actorMargin: 50,
            width: 150,
            height: 65,
            boxMargin: 10,
            boxTextMargin: 5,
            noteMargin: 10,
            messageMargin: 35,
          },
          gantt: {
            useMaxWidth: true,
          },
        });

        // Initial render - find all mermaid elements and render them
        await m.run({ querySelector: ".mermaid" });
      } catch (err) {
        console.warn("Failed to initialize mermaid:", err);
      }
    };

    initMermaid();
  }, []);

  return null;
}
