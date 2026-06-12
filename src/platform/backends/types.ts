// src/platform/backends/types.ts
//
// ログ抽象化のコア型定義。
// 全プラットフォーム（VSCode / Node.js / Electron）から共有される。

// ── ログレベル ──────────────────────────────────────────────────────────────

export const LogLevel = {
  trace: 0,
  debug: 1,
  info:  2,
  warn:  3,
  error: 4,
  silent: 5,
} as const;

export type LogLevelName = keyof typeof LogLevel;
export type LogLevelValue = (typeof LogLevel)[LogLevelName];

// ── ログレコード ────────────────────────────────────────────────────────────
// 1 つのログ emit が生成するイミュータブルなデータ構造。
// バックエンドはこのレコードを受け取り、フォーマット・出力先を決定する。

export interface LogRecord {
  /** ログレベル */
  readonly level: LogLevelValue;
  /** ロガーカテゴリ（通常はモジュール名、例: "orchestrator", "session"） */
  readonly category: string;
  /** ログメッセージ（テンプレート可。context と合わせてフォーマット） */
  readonly message: string;
  /** 生成時のタイムスタンプ (epoch ms) */
  readonly timestamp: number;
  /** 構造化コンテキスト。テンプレート置換・フィルタリングに利用 */
  readonly context?: Record<string, unknown>;
  /** 関連するエラーがある場合 */
  readonly error?: Error;
}

// ── Logger インターフェース ────────────────────────────────────────────────
// アプリケーションコードから呼び出されるロガー。
// 内部で LoggerBackend.emit() を呼ぶ薄いファサード。

export interface Logger {
  readonly category: string;
  readonly minLevel: LogLevelValue;

  trace(msg: string, context?: Record<string, unknown>): void;
  debug(msg: string, context?: Record<string, unknown>): void;
  info(msg: string, context?: Record<string, unknown>): void;
  warn(msg: string, context?: Record<string, unknown>): void;
  error(msg: string, context?: Record<string, unknown>, error?: Error): void;

  /** カテゴリ名を継承した子ロガーを作成 */
  child(suffix: string): Logger;
}

// ── LoggerBackend インターフェース ─────────────────────────────────────────
// ログの実出力先を抽象化。各プラットフォームが独自実装を提供する。
// パイプライン: Logger → LoggerBackend.emit() → 出力先 / OutputChannel / ファイル etc.

export interface LoggerBackend {
  /** 最低出力レベル。これ未満のレコードは即座に破棄される */
  minLevel: LogLevelValue;

  /** 1レコード出力。呼び出しは non-blocking であるべき */
  emit(record: LogRecord): void;

  /** バッファフラッシュが必要なバックエンド用（no-op 可） */
  flush?(): Promise<void>;

  /** リソース解放が必要なバックエンド用（no-op 可） */
  dispose?(): void;
}

// ── LoggerFactory ──────────────────────────────────────────────────────────
// トップレベルで Logger インスタンスを生成するファクトリ。
// PlatformAPI がこのファクトリを保持し、アプリケーション層に公開する。

export interface LoggerFactory {
  getLogger(category: string): Logger;
  /** 全ロガーの最小レベルを一括変更 */
  setLevel(level: LogLevelValue): void;
  /** バックエンドを差し替え（実行時切替対応） */
  setBackend(backend: LoggerBackend): void;
}
