export interface Stream {
  setStatus(s: string): void;
  chunk(text: string): void;
  endLine(): void;
  write(s: string): void;
  print(msg: string): void;
  nl(): void;
  columns(): number;
  resize(): void;
  reset(): void;
}
export function createStream(
  rawWrite: (s: string) => void,
  cols?: () => number,
  rows?: () => number,
): Stream;
