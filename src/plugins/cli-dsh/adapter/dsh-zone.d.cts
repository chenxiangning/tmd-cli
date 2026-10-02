export interface ZonePrint {
  print(msg: string): void;
  write(s: string): void;
  columns(): number;
}
/** 鼠标路由面(dsh-click 的结构面):可注入便于纯逻辑测试。 */
export interface ZoneClick {
  requestCursor(): Promise<number | null>;
  setZone(start: number, entries: (Array<(() => void) | null> | null)): void;
  clearZone(): void;
  hit(row: number): boolean;
}
export interface Zone {
  show(lines: string[], entries: (Array<(() => void) | null> | null)): void;
  hide(): void;
  eraseAndHide(): void;
  /** 终端改尺寸:点击区行号作废(下次 show 用 CPR 重定位)。 */
  onResize(): void;
  hit(row: number): boolean;
}
export function createZone(print: ZonePrint, clickDep?: ZoneClick): Zone;
export function clipWidth(print: { columns(): number }, s: string): string;
