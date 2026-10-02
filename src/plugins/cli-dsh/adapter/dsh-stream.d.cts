export interface Stream {
  setStatus(s: string): void;
  chunk(text: string): void;
  endLine(): void;
  write(s: string): void;
  print(msg: string): void;
  nl(): void;
  columns(): number;
  /** 出内容前钉滚动区(见 dsh-stream 头注:先钉区,内容光标才留得住)。 */
  arm(): void;
  resize(): void;
  reset(): void;
}
export function createStream(
  rawWrite: (s: string) => void,
  cols?: () => number,
  rows?: () => number,
): Stream;
