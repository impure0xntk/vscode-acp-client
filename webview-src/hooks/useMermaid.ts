import { useEffect, useRef, useCallback } from "react";

/**
 * Initialize mermaid.js for diagram rendering.
 * Call this once on app mount and after new markdown content is rendered.
 */
export function useMermaid(): void {
  const initializedRef = useRef(false);

  useEffect(() => {
    // Dynamic import to avoid SSR issues
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

        // Run initial render
        await m.run({ querySelector: ".mermaid" });
        initializedRef.current = true;
      } catch (err) {
        console.warn("Failed to initialize mermaid:", err);
      }
    };

    initMermaid();
  }, []);
}

/**
 * Re-render mermaid diagrams in the current document.
 * Call this after new markdown content is added to the DOM.
 */
export function useMermaidRenderer(): () => Promise<void> {
  const pendingRef = useRef(false);

  const render = useCallback(async () => {
    if (pendingRef.current) return;
    pendingRef.current = true;

    try {
      const mermaid = await import("mermaid");
      const m = mermaid.default;

      // Find all unrendered mermaid elements
      const elements = document.querySelectorAll(
        ".mermaid:not([data-processed])"
      );

      if (elements.length === 0) {
        pendingRef.current = false;
        return;
      }

      // Mark as processed to avoid re-rendering
      elements.forEach((el) => {
        el.setAttribute("data-processed", "true");
      });

      // Render each element individually to catch errors per diagram
      for (const el of Array.from(elements) as unknown as HTMLElement[]) {
        try {
          // mermaid.run() will automatically process elements with class "mermaid"
          // that don't have data-processed attribute
          await m.run({
            nodes: [el],
          });
        } catch (err) {
          console.warn("Mermaid render error:", err);
          // Replace with error message
          const errorDiv = document.createElement("div");
          errorDiv.className = "mermaid-error";
          errorDiv.style.cssText = `
            padding: 8px 12px;
            background: var(--vscode-inputValidation-errorBackground, #5a1d1d);
            border: 1px solid var(--vscode-inputValidation-errorBorder, #f14c4c);
            border-radius: 4px;
            color: var(--vscode-inputValidation-errorForeground, #f14c4c);
            font-family: var(--vscode-editor-font-family, monospace);
            font-size: 12px;
            overflow-x: auto;
          `;
          errorDiv.textContent = `Mermaid render error: ${err instanceof Error ? err.message : String(err)}`;
          el.replaceWith(errorDiv);
        }
      }
    } catch (err) {
      console.warn("Failed to load mermaid:", err);
    } finally {
      pendingRef.current = false;
    }
  }, []);

  return render;
}

/**
 * Hook that combines initialization and provides a re-render function.
 * Use this in components that need to trigger mermaid re-rendering.
 */
export function useMermaidWithRender(): () => Promise<void> {
  useMermaid();
  return useMermaidRenderer();
}
