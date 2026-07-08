import MarkdownIt from "markdown-it";
import hljs from "highlight.js";
import DOMPurify from "dompurify";
import type {} from "trusted-types";
import plantumlPlugin from "markdown-it-plantuml";

type PurifyConfig = Parameters<typeof DOMPurify.sanitize>[1];
import { IconFile } from "./icons";

const FILE_ICON_SVG = `<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="inline-code-link-icon" xmlns="http://www.w3.org/2000/svg"><path d="M3 1.5h6l3.5 3.5v9a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1v-12a1 1 0 0 1 1-1z" /><path d="M9.5 1.5V4a1 1 0 0 0 1 1h3.5" /></svg>`;

export interface RenderContext {
  /** File paths confirmed to exist by the extension host */
  filePaths?: Set<string>;
}

const LANG_LABELS: Record<string, string> = {
  javascript: "JavaScript",
  typescript: "TypeScript",
  python: "Python",
  rust: "Rust",
  go: "Go",
  java: "Java",
  c: "C",
  cpp: "C++",
  csharp: "C#",
  ruby: "Ruby",
  php: "PHP",
  swift: "Swift",
  kotlin: "Kotlin",
  scala: "Scala",
  shell: "Shell",
  bash: "Bash",
  zsh: "Zsh",
  powershell: "PowerShell",
  sql: "SQL",
  html: "HTML",
  css: "CSS",
  scss: "SCSS",
  json: "JSON",
  yaml: "YAML",
  toml: "TOML",
  xml: "XML",
  markdown: "Markdown",
  dockerfile: "Dockerfile",
  makefile: "Makefile",
  diff: "Diff",
  nginx: "Nginx",
  vim: "Vim",
  lua: "Lua",
  r: "R",
  dart: "Dart",
  elixir: "Elixir",
  erlang: "Erlang",
  haskell: "Haskell",
  clojure: "Clojure",
  ocaml: "OCaml",
  fortran: "Fortran",
  assembly: "Assembly",
  wasm: "WASM",
  graphql: "GraphQL",
  regex: "Regex",
  http: "HTTP",
  ini: "INI",
  properties: "Properties",
  nix: "Nix",
};

function getLangLabel(lang: string): string {
  if (!lang) return "";
  const lower = lang.toLowerCase();
  if (LANG_LABELS[lower]) return LANG_LABELS[lower];
  return lang.charAt(0).toUpperCase() + lang.slice(1);
}

/** Build a code-block wrapper with language label + copy button */
function codeBlockTemplate(
  labelAttr: string,
  escapedLabel: string,
  codeHtml: string
): string {
  const hasLabel = escapedLabel.length > 0;
  const labelHtml = hasLabel
    ? `<span class="code-block-lang">${escapedLabel}</span>`
    : "";
  // When there is no label we still show the header so the copy button
  // remains accessible, but mark it with a CSS class so it can be visually
  // hidden while keeping the button.
  const headerHtml = hasLabel
    ? `<div class="code-block-header">${labelHtml}` +
      `<button class="code-block-copy" type="button" aria-label="Copy code" data-action="copy">` +
      `<svg class="icon-copy" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">` +
      `<rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>` +
      `</svg>` +
      `<svg class="icon-check" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">` +
      `<polyline points="20 6 9 17 4 12"/>` +
      `</svg>` +
      `</button></div>`
    : `<div class="code-block-header code-block-header--no-label">` +
      `<button class="code-block-copy code-block-copy--only" type="button" aria-label="Copy code" data-action="copy">` +
      `<svg class="icon-copy" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">` +
      `<rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>` +
      `</svg>` +
      `<svg class="icon-check" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">` +
      `<polyline points="20 6 9 17 4 12"/>` +
      `</svg>` +
      `</button></div>`;

  return (
    `<div class="code-block-wrapper" data-code-block-wrapper${labelAttr} data-label="${escapedLabel}">` +
    headerHtml +
    `<pre class="hljs"><code>${codeHtml}</code></pre>` +
    `</div>`
  );
}

/**
 * Check if code block is a mermaid diagram.
 * Supports: ```mermaid, graph TD/LR/RL/BT, sequenceDiagram, gantt, flowchart
 */
function isMermaidBlock(info: string, firstLine: string): boolean {
  if (info === "mermaid") return true;
  if (firstLine === "gantt" || firstLine === "sequenceDiagram") return true;
  // flowchart diagrams start with graph (various directions) or flowchart
  if (firstLine.match(/^(graph|flowchart)\s+(?:TB|BT|RL|LR|TD);?$/))
    return true;
  return false;
}

const md = new MarkdownIt({
  html: true,
  linkify: true,
  typographer: true,
  highlight: (str: string, lang: string): string => {
    const escapedLang = md.utils.escapeHtml(lang || "");
    const label = getLangLabel(lang || "");
    const escapedLabel = md.utils.escapeHtml(label);
    const labelAttr = escapedLang ? ` data-lang="${escapedLang}"` : "";

    if (lang && hljs.getLanguage(lang)) {
      try {
        const highlighted = hljs.highlight(str, {
          language: lang,
          ignoreIllegals: true,
        }).value;
        return codeBlockTemplate(labelAttr, escapedLabel, highlighted);
      } catch {
        // fall through to plain text
      }
    }
    return codeBlockTemplate(labelAttr, escapedLabel, md.utils.escapeHtml(str));
  },
});

// Custom mermaid fence renderer - wraps in <div class="mermaid"> for client-side rendering
const defaultFence = md.renderer.rules.fence;
md.renderer.rules.fence = (tokens, idx, options, env, slf) => {
  const token = tokens[idx];
  const firstLine = token.content.split(/\n/)[0].trim();

  if (isMermaidBlock(token.info, firstLine)) {
    // Wrap in mermaid div for client-side rendering (handled by useMermaid hook)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return `<div class="mermaid">${md.utils.escapeHtml(token.content)}</div>`;
  }

  // Fall back to default fence renderer
  if (defaultFence) {
    return defaultFence(tokens, idx, options, env, slf);
  }
  return `<pre${token.info ? ` data-lang="${md.utils.escapeHtml(token.info)}"` : ""}><code>${md.utils.escapeHtml(token.content)}</code></pre>`;
};

// Register plantuml plugin (uses @startuml/@enduml blocks)
md.use(plantumlPlugin, {
  imageFormat: "svg",
  diagramName: "uml",
  // Use a public PlantUML server for rendering
  server: "https://www.plantuml.com/plantuml",
});

// code_block uses the same wrapper as fence but without a language label
md.renderer.rules.code_block = (tokens, idx) => {
  const token = tokens[idx];
  const codeHtml = md.utils.escapeHtml(token.content);
  return codeBlockTemplate("", "", codeHtml);
};

// Only link inline code paths that are confirmed to exist by the extension host
const defaultCodeInline = md.renderer.rules.code_inline;
md.renderer.rules.code_inline = (tokens, idx, options, env, self) => {
  const token = tokens[idx];
  const content = token.content;
  const ctx = (env as RenderContext) || {};
  if (ctx.filePaths && ctx.filePaths.has(content)) {
    const escaped = md.utils.escapeHtml(content);
    const basename = content.split("/").pop() ?? content;
    const escapedLabel = md.utils.escapeHtml(basename);
    return `<a class="inline-code-link" data-file-path="${escaped}" title="${escaped}" tabindex="0" role="button"><span class="inline-code-link-icon">${FILE_ICON_SVG}</span><span class="inline-code-link-label">${escapedLabel}</span></a>`;
  }
  if (defaultCodeInline) {
    return defaultCodeInline(tokens, idx, options, env, self);
  }
  return `<code>${md.utils.escapeHtml(content)}</code>`;
};

const PURIFY_OPTS: PurifyConfig = {
  ADD_TAGS: ["a", "span", "div", "button", "svg", "path", "img", "pre", "code"],
  ADD_ATTR: [
    "class",
    "data-action",
    "data-file-path",
    "title",
    "tabindex",
    "role",
    "data-lang",
    "data-label",
    "data-copied",
    "aria-label",
    "xmlns",
    "viewBox",
    "fill",
    "stroke",
    "stroke-width",
    "stroke-linecap",
    "stroke-linejoin",
    "d",
    "src",
    "alt",
    "width",
    "height",
    "style",
  ],
};

/**
 * LRU cache for rendered markdown HTML.
 * Keyed by content hash + filePaths set identity.
 * Max 50 entries — old entries are evicted automatically.
 */
const markdownCache = new Map<string, string>();
const MARKDOWN_CACHE_MAX = 50;

function getCacheKey(content: string, ctx?: RenderContext): string {
  // Fast hash: length + first 64 chars + last 32 chars + filePaths size
  const len = content.length;
  const head = len > 64 ? content.slice(0, 64) : content;
  const tail = len > 32 ? content.slice(-32) : "";
  const fpSize = ctx?.filePaths?.size ?? 0;
  return `${len}:${fpSize}:${head}:${tail}`;
}

export function renderMarkdown(content: string, ctx?: RenderContext): string {
  const cacheKey = getCacheKey(content, ctx);
  const cached = markdownCache.get(cacheKey);
  if (cached !== undefined) return cached;

  const env: RenderContext = ctx || {};
  const rawHtml = md.render(content, env);
  const result = DOMPurify.sanitize(rawHtml, PURIFY_OPTS) as unknown as string;

  // Evict oldest if at capacity
  if (markdownCache.size >= MARKDOWN_CACHE_MAX) {
    const firstKey = markdownCache.keys().next().value;
    if (firstKey !== undefined) markdownCache.delete(firstKey);
  }
  markdownCache.set(cacheKey, result);
  return result;
}

export function renderInline(content: string, ctx?: RenderContext): string {
  const env: RenderContext = ctx || {};
  const rawHtml = md.renderInline(content, env);
  return DOMPurify.sanitize(rawHtml, PURIFY_OPTS) as unknown as string;
}
