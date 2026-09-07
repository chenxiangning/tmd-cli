export interface MenuItem {
  label: string;
  hint?: string;
  value: unknown;
  current?: boolean;
}
export interface MenuState {
  kind: string;
  title: string;
  items: MenuItem[];
  sel: number;
  height: number;
}
export interface RenderOpts { header?: string; footer?: string; }
export function createMenu(kind: string, title: string, items: MenuItem[], currentValue: unknown): MenuState;
export function move(menu: MenuState, delta: number): void;
export function pickDigit(menu: MenuState, d: number): boolean;
export function current(menu: MenuState): MenuItem | null;
export function renderLines(menu: MenuState, opts?: RenderOpts): string[];
export function windowTop(menu: MenuState): number;
export const MAX_VISIBLE: number;
