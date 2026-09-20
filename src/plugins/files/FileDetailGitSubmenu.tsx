/**
 * 详情页右键菜单的「Git 操作 ▸」子菜单 —— fixed 定位(.wsmenu 的 overflow 会剪裁
 * 绝对定位子元素),右侧放不下翻左。暂存/取消暂存/放弃改动(两步武装)直驱 git ipc;
 * 文件历史开 git 插件中央 tab;Git Blame 内嵌开关(编辑器 gutter,见 cmEditor/editorBlame)。
 */

import { useRef, useState } from "react";
import {
  ArrowCounterClockwise,
  CaretRight,
  ClockCounterClockwise,
  GitBranch,
  GitCommit,
  Minus,
  Plus,
} from "@phosphor-icons/react";
import { t } from "@kernel/i18n";
import { ipc } from "@kernel/ipc";
import { openFileHistoryTab } from "@plugins/git/fileHistoryTab";
import { item, type Pick } from "./wsmenuItem";

const GIT_OPS = {
  stage: (cwd: string, rel: string) => ipc.gitStage(cwd, [rel]),
  unstage: (cwd: string, rel: string) => ipc.gitUnstage(cwd, [rel]),
  discard: (cwd: string, rel: string) => ipc.gitDiscard(cwd, [rel]),
} as const;

export function FileDetailGitSubmenu({
  cwd,
  rel,
  pick,
  blameActive = false,
  onToggleBlame,
}: {
  cwd: string;
  rel: string;
  pick: Pick;
  blameActive?: boolean;
  onToggleBlame?: () => void;
}) {
  const [armed, setArmed] = useState(false);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const run = (op: keyof typeof GIT_OPS) => {
    void GIT_OPS[op](cwd, rel).catch(() => undefined);
  };
  const open = () => {
    const r = hostRef.current?.getBoundingClientRect();
    if (!r) return;
    const W = 176;
    const x = r.right + W + 8 > window.innerWidth ? r.left - W + 4 : r.right - 4;
    setPos({ x, y: Math.max(8, Math.min(r.top - 6, window.innerHeight - 190)) });
  };
  return (
    <div ref={hostRef} className="wsmenu-submenu-host" onMouseEnter={open} onMouseLeave={() => setPos(null)}>
      <button type="button" className="wsmenu-item">
        <span className="wsmenu-item-icon"><GitBranch size="0.8125rem" /></span>
        <span className="wsmenu-item-label">{t("Git 操作")}</span>
        <span className="wsmenu-item-kbd"><CaretRight size="0.8125rem" /></span>
      </button>
      {pos && (
        <div className="wsmenu-submenu" role="menu" style={{ left: pos.x, top: pos.y }}>
          {item(t("暂存"), <Plus size="0.8125rem" />, () => pick(() => run("stage")))}
          {item(t("取消暂存"), <Minus size="0.8125rem" />, () => pick(() => run("unstage")))}
          {item(armed ? t("确认放弃改动?") : t("放弃改动"), <ArrowCounterClockwise size="0.8125rem" />, () => {
            if (!armed) {
              setArmed(true);
              return;
            }
            pick(() => run("discard"));
          }, { danger: armed })}
          <div className="wsmenu-divider" />
          {item(t("显示文件历史"), <ClockCounterClockwise size="0.8125rem" />, () =>
            pick(() => openFileHistoryTab({ cwd, path: rel })), { kbd: "⌥⇧H" })}
          {onToggleBlame &&
            item(
              blameActive ? t("隐藏 Git Blame") : t("显示 Git Blame"),
              <GitCommit size="0.8125rem" />,
              () => pick(onToggleBlame),
              { kbd: "⌥⇧B" },
            )}
        </div>
      )}
    </div>
  );
}
