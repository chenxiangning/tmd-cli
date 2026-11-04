/**
 * RPC 对话框键盘编排 —— 从 SsComposer 拆出(300 行铁则 + 复杂度出件)。
 * 优先级序:confirm Esc 拒绝 > 触发器候选(↑↓/Enter/Tab/Esc)>
 * / 命令补全(cmd.onKey 自管)> 发送快捷键(设置项 Enter 或 ⌘/Ctrl+Enter)。
 */
import type { SuggestionMatch } from "@plugins/composer/triggers/suggest";
import type { SsSessionState } from "./ssSession";

/** useCmdComplete 键盘面(SsComposer 内部类型,这里只依赖其形)。 */
export type SsCmdKeys = {
  onKey: (e: { key: string; shiftKey: boolean; nativeEvent: { isComposing: boolean }; preventDefault(): void }) => boolean;
};

export function makeSsKeydown({ ss, cmd, matches, pickIndex, setPickIndex, applyPick, dismiss, cmdOrCtrl }: {
  ss: SsSessionState;
  cmd: SsCmdKeys;
  matches: SuggestionMatch[] | null;
  pickIndex: number;
  setPickIndex: React.Dispatch<React.SetStateAction<number>>;
  applyPick: (m: SuggestionMatch) => void;
  dismiss: () => void;
  cmdOrCtrl: boolean;
}): (e: React.KeyboardEvent<HTMLTextAreaElement>) => void {
  /* 触发器候选键:↑↓ 移动,Enter/Tab 选定,Esc 关闭(唤醒注入未消费则回收)。 */
  const triggerKeys = (e: React.KeyboardEvent<HTMLTextAreaElement>): boolean => {
    if (!matches || matches.length === 0) return false;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setPickIndex((i) => (i + (e.key === "ArrowDown" ? 1 : -1) + matches.length) % matches.length);
      return true;
    }
    if (e.key === "Enter" || e.key === "Tab") {
      if (e.nativeEvent.isComposing) return true;
      e.preventDefault();
      applyPick(matches[pickIndex]);
      return true;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      dismiss();
      return true;
    }
    return false;
  };
  return (e) => {
    if (ss.confirm && !e.nativeEvent.isComposing && e.key === "Escape") {
      e.preventDefault();
      ss.answerConfirm(false);
      return;
    }
    if (triggerKeys(e)) return;
    if (cmd.onKey(e)) return;
    const sendKey = cmdOrCtrl
      ? e.key === "Enter" && (e.metaKey || e.ctrlKey)
      : e.key === "Enter" && !e.shiftKey;
    if (sendKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      ss.send();
    }
  };
}
