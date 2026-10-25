/**
 * terminal.find 命令桥(spec 2026-09-05-shortcuts)—— 自 terminalSearch.tsx 拆出
 * (组件文件不携带非组件导出)。
 * 终端内自由快捷键一律不变:键照旧进 PTY,只有 terminal 作用域命令经分发器触发。
 * 一期唯一成员 terminal.find(⌘F,行为与桥接入前完全一致);搜索 UI 归内核终端
 * 本体,故命令在此登记,激活的组件实例经 findRequestRef 接收触发。
 * 0.4.5:磁盘日志搜索桥(makeLogSearchBridge)同住 —— ⌘F 缓冲零命中时搜完整
 * 64MB 旋转日志,TerminalView 注入、terminalSearchLog.tsx(组件面)消费。
 */
import type { RefObject } from "react";
import type { Terminal } from "@xterm/xterm";
import { ipc, type LogSearchResult } from "@kernel/ipc";
import { t } from "@kernel/i18n";
import type { TerminalHistoryPager } from "@kernel/terminalHistory";
import { registerCommand } from "@kernel/shortcuts";

export const findRequestRef: { current: (() => void) | null } = { current: null };
registerCommand({
  id: "terminal.find",
  title: "终端搜索",
  keybinding: "Cmd+F",
  scope: "terminal",
  run: () => findRequestRef.current?.(),
});

/** 日志搜索桥契约:hasEarlier = 日志还有更早字节;search/jump 见实现注释。 */
export interface LogSearchBridge {
  /** 日志还有未加载进缓冲的更早字节(翻页器 hasMore)。 */
  hasEarlier: () => boolean;
  /** 磁盘全文搜索(null = 无日志/失败,入口静默退场)。 */
  search: (needle: string, caseSensitive: boolean) => Promise<LogSearchResult | null>;
  /** 窗口化跳转到字节偏移;返回是否落位。 */
  jump: (offset: number) => Promise<boolean>;
}

/** 桥工厂(TerminalView 注入,保持视图文件行预算,0.4.5):pager/term 经 ref 晚绑定。 */
export function makeLogSearchBridge(
  sessionId: string,
  pagerRef: RefObject<TerminalHistoryPager | null>,
  termRef: RefObject<Terminal | null>,
): LogSearchBridge {
  return {
    hasEarlier: () => pagerRef.current?.hasMoreHistory() ?? false,
    search: async (needle, caseSensitive) => {
      try {
        return await ipc.sessionLogSearch(sessionId, needle, caseSensitive);
      } catch {
        return null;
      }
    },
    jump: async (offset) => {
      const term = termRef.current;
      const pager = pagerRef.current;
      if (!term || !pager) return false;
      return pager.jumpToByte(term, offset, t("⋯ 已跳过较早输出(定位跳转)⋯"));
    },
  };
}
