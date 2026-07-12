export interface ContextAttachment {
  id: string;
  type: string;
  path: string;
  label: string;
  tokenCount: number;
  content: string;
  lineRange?: [number, number];
  /** Short human-readable summary — for `problem` attachments this is the
   * diagnostic message, used by the Composer chip label. */
  message?: string;
}
