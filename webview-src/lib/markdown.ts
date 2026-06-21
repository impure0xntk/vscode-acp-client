import MarkdownIt from "markdown-it";
import hljs from "highlight.js";
import DOMPurify from "dompurify";
import type {} from "trusted-types";

type PurifyConfig = Parameters<typeof DOMPurify.sanitize>[1];
import { IconFile } from "./icons";

const FILE_ICON_SVG = `<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="inline-code-link-icon" xmlns="http://www.w3.org/2000/svg"><path d="M3 1.5h6l3.5 3.5v9a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1v-12a1 1 0 0 1 1-1z" /><path d="M9.5 1.5V4a1 1 0 0 0 1 1h3.5" /></svg>`;

// ---------------------------------------------------------------------------
// Render context — passed to the code_inline renderer via markdown-it `env`.
// ---------------------------------------------------------------------------

export interface RenderContext {
  /** File paths confirmed to exist by the extension host */
  filePaths?: Set<string>;
}

// ---------------------------------------------------------------------------
// Language label map — maps hljs language keys to human-readable labels
// ---------------------------------------------------------------------------

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
  // Fallback: capitalise first letter
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
  // Only render the header bar when there's a language label or we want the
  // copy button to remain accessible.  When there is no label we still show
  // the header so the copy button is available, but we mark it with a CSS
  // class so the header can be visually hidden while keeping the button.
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

// ---------------------------------------------------------------------------
// Markdown-it instance with custom code block renderer
// ---------------------------------------------------------------------------

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

// Override code_block renderer: use the same wrapper as fence (no language label)
md.renderer.rules.code_block = (tokens, idx) => {
  const token = tokens[idx];
  const codeHtml = md.utils.escapeHtml(token.content);
  return codeBlockTemplate("", "", codeHtml);
};

// Override code_inline renderer: only links paths confirmed to exist
const defaultCodeInline = md.renderer.rules.code_inline;
md.renderer.rules.code_inline = (tokens, idx, options, env, self) => {
  const token = tokens[idx];
  const content = token.content;
  const ctx = (env as RenderContext) || {};
  if (ctx.filePaths && ctx.filePaths.has(content)) {
    const escaped = md.utils.escapeHtml(content);
    return `<a class="inline-code-link" data-file-path="${escaped}" title="${escaped}" tabindex="0" role="button"><span class="inline-code-link-icon">${FILE_ICON_SVG}</span><span class="inline-code-link-label">${escaped}</span></a>`;
  }
  if (defaultCodeInline) {
    return defaultCodeInline(tokens, idx, options, env, self);
  }
  return `<code>${md.utils.escapeHtml(content)}</code>`;
};

const PURIFY_OPTS: PurifyConfig = {
  ADD_TAGS: ["a", "span", "div", "button", "svg", "path"],
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
  ],
};

export function renderMarkdown(content: string, ctx?: RenderContext): string {
  const env: RenderContext = ctx || {};
  const rawHtml = md.render(content, env);
  return DOMPurify.sanitize(rawHtml, PURIFY_OPTS) as unknown as string;
}

export function renderInline(content: string, ctx?: RenderContext): string {
  const env: RenderContext = ctx || {};
  const rawHtml = md.renderInline(content, env);
  return DOMPurify.sanitize(rawHtml, PURIFY_OPTS) as unknown as string;
}
