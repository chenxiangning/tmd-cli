export interface ZonePrint {
  print(msg: string): void;
  write(s: string): void;
  columns(): number;
}
export interface Zone {
  show(lines: string[], entries: (Array<(() => void) | null> | null)): void;
  hide(): void;
  eraseAndHide(): void;
  hit(row: number): boolean;
}
export function createZone(print: ZonePrint): Zone;
export function clipWidth(print: { columns(): number }, s: string): string;
