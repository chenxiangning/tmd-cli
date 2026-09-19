/**
 * 看板覆盖层开关 —— 插件局部状态(市场页同款「不透明覆盖、下层零回放」语义)。
 * BoardButton(左上角)/侧栏动作 toggle,BoardOverlay 渲染,Esc/× 收起。
 */

let open = false;
const subs = new Set<() => void>();

function emit() {
  for (const fn of subs) fn();
}

export function boardOverlayOpen(): boolean {
  return open;
}

export function toggleBoardOverlay(): void {
  open = !open;
  emit();
}

export function closeBoardOverlay(): void {
  if (!open) return;
  open = false;
  emit();
}

/** useSyncExternalStore 订阅面。 */
export function subscribeBoardOverlay(cb: () => void): () => void {
  subs.add(cb);
  return () => {
    subs.delete(cb);
  };
}
