export interface ThinkStripper {
  feed(text: string): string;
  flush(): string;
}
export function createThinkStripper(): ThinkStripper;
