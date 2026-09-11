/**
 * 终端复制/停止菜单 —— Cmd/Ctrl+C 的拦截面浮层(2026-09-11 诉求,拆分法同
 * terminalSearch/terminalFindBridge:组件文件不携带非组件导出)。
 * 复制 = 打开时快照 xterm 选区写剪贴板(无选区置灰);停止终端 = 补发 \x03,
 * 与原 Ctrl+C 字节语义一致(经 host.writeSession 唯一写入口,锚定语义不变)。
 * 纯 UI 点缀不触碰字节流:命中拦截发生在分发器,这里只消费触发。
 */
import { useEffect, useRef, useState, type RefObject } from "react";
import type { Terminal } from "@xterm/xterm";
import { host } from "@kernel/host";
import { t } from "@kernel/i18n";
import { copyMenuRequestRef } from "@kernel/terminalCopyMenuBridge";

export function TerminalCopyMenu({
  termRef,
  sessionId,
  active,
}: {
  termRef: RefObject<Terminal | null>;
  sessionId: string;
  active: boolean;
}) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const selRef = useRef("");
  const mouse = useRef({ x: 0, y: 0 });
  /* 单槽跟随激活实例(同 findRequestRef):keep-alive 多幕布并存,仅激活幕布接触发并记鼠标锚点。 */
  useEffect(() => {
    if (!active) return;
    const open = () => {
      selRef.current = termRef.current?.getSelection() ?? "";
      const m = mouse.current;
      setPos({ x: m.x || window.innerWidth / 2, y: m.y || window.innerHeight / 3 });
    };
    /* 键盘触发的菜单无天然锚点,锚最近鼠标点;监听随激活槽挂摘。 */
    const onMove = (e: MouseEvent) => {
      mouse.current.x = e.clientX;
      mouse.current.y = e.clientY;
    };
    window.addEventListener("mousemove", onMove);
    copyMenuRequestRef.current = open;
    return () => {
      window.removeEventListener("mousemove", onMove);
      if (copyMenuRequestRef.current === open) copyMenuRequestRef.current = null;
    };
  }, [active, termRef]);
  /* 弹层期 Escape 本地吃掉(零 PTY 字节、不分发),同弹层 Esc 生态;非快捷键注册。 */
  useEffect(() => {
    if (!pos) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      setPos(null);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [pos]);

  if (!pos) return null;
  const act = (fn: () => void) => {
    fn();
    setPos(null);
    termRef.current?.focus();
  };
  const left = Math.max(8, Math.min(pos.x, window.innerWidth - 136));
  const top = Math.max(8, Math.min(pos.y, window.innerHeight - 88));
  return (
    <>
      <div className="fixed inset-0 z-40" onMouseDown={() => setPos(null)} />
      <div
        className="fixed z-50 w-32 overflow-hidden rounded-md border border-(--tmd-border) bg-(--tmd-bg-popover) py-1 shadow-lg"
        style={{ left, top }}
      >
        <button
          disabled={!selRef.current}
          onClick={() =>
            act(() => void navigator.clipboard.writeText(selRef.current).catch(() => {}))
          }
          className="block w-full px-3 py-1.5 text-left text-xs text-(--tmd-fg) hover:bg-(--tmd-bg-hover) disabled:opacity-50 disabled:hover:bg-transparent"
        >
          {t("复制")}
        </button>
        <button
          onClick={() => act(() => host.writeSession(sessionId, "\x03"))}
          className="block w-full px-3 py-1.5 text-left text-xs text-(--tmd-fg) hover:bg-(--tmd-bg-hover)"
        >
          {t("停止终端")}
        </button>
      </div>
    </>
  );
}
