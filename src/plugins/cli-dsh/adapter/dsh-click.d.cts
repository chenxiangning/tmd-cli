export interface ClickStream { write(s: string): void; }
export function init(stream: ClickStream | null): void;
export function setZone(start: number, entries: (Array<(() => void) | null> | null)): void;
export function clearZone(): void;
export function hit(row: number): boolean;
export function requestCursor(): Promise<number | null>;
export function onCpr(row: number): void;
