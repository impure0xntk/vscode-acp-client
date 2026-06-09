import MarkdownIt from "markdown-it";
import hljs from "highlight.js";
import DOMPurify from "dompurify";

// ---------------------------------------------------------------------------
// Render context — passed to the code_inline renderer via markdown-it `env`.
// ---------------------------------------------------------------------------

export interface RenderContext {
  /** File paths confirmed to exist by the extension host */
  filePaths?: Set<string>;
}

// ---------------------------------------------------------------------------
// Markdown-it instance with custom code_inline renderer
// ---------------------------------------------------------------------------

const md = new MarkdownIt({
  html: true,
  linkify: true,
  typographer: true,
  highlight: (str: string, lang: string): string => {
    if (lang && hljs.getLanguage(lang)) {
      try {
        return `<pre class="hljs"><code>${hljs.highlight(str, { language: lang, ignoreIllegals: true }).value}</code></pre>`;
      } catch {
        // fall through to plain text
      }
    }
    return `<pre class="hljs"><code>${md.utils.escapeHtml(str)}</code></pre>`;
  },
});

// Override code_inline renderer: only links paths confirmed to exist
const defaultCodeInline = md.renderer.rules.code_inline;
md.renderer.rules.code_inline = (tokens, idx, options, env, self) => {
  const token = tokens[idx];
  const content = token.content;
  const ctx = (env as RenderContext) || {};
  if (ctx.filePaths && ctx.filePaths.has(content)) {
    const escaped = md.utils.escapeHtml(content);
    const basename = content.split("/").pop() ?? content;
    const escapedBase = md.utils.escapeHtml(basename);
    return `<a class="inline-code-link" data-file-path="${escaped}" title="${escaped}" tabindex="0" role="button"><span class="inline-code-link-icon">📄</span><span class="inline-code-link-label">${escapedBase}</span></a>`;
  }
  if (defaultCodeInline) {
    return defaultCodeInline(tokens, idx, options, env, self);
  }
  return `<code>${md.utils.escapeHtml(content)}</code>`;
};

const PURIFY_OPTS: DOMPurify.Config = {
  ADD_TAGS: ["a", "span"],
  ADD_ATTR: ["class", "data-file-path", "title", "tabindex", "role"],
};

export function renderMarkdown(content: string, ctx?: RenderContext): string {
  const env: RenderContext = ctx || {};
  const rawHtml = md.render(content, env);
  return DOMPurify.sanitize(rawHtml, PURIFY_OPTS);
}

export function renderInline(content: string, ctx?: RenderContext): string {
  const env: RenderContext = ctx || {};
  const rawHtml = md.renderInline(content, env);
  return DOMPurify.sanitize(rawHtml, PURIFY_OPTS);
}
