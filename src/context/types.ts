export interface ContextAttachment {
  id: string;
  type: string;
  path: string;
  label: string;
  tokenCount: number;
  content: string;
  lineRange?: [number, number];
}
