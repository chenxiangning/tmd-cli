/**
 * 本地分支按 worktree 检出归属的三分区渲染(自 BranchView 拆出:
 * 文件规模铁则 + no-high-complexity)。数据由 worktreeBranchGroups 纯函数产出;
 * 行级行为(切换/删除/右键)经 handlers 回调回 BranchView,此处零业务。
 */

import { t } from "@kernel/i18n";
import type { GitBranchInfo } from "@kernel/ipc";
import { BranchRow } from "./BranchRow";
import type { WorktreeBranchGroups } from "../worktree/worktreeBranchGroups";

export interface LocalGroupHandlers {
  currentName: string | undefined;
  onCheckout: (b: GitBranchInfo) => void;
  onDelete: (b: GitBranchInfo, force: boolean) => void;
  onMenu: (b: GitBranchInfo, x: number, y: number) => void;
  /** 未检出分支行尾「建树」:打开 worktree 弹窗(检出已有分支模式,预填)。 */
  onCreateTree: (branch: string) => void;
}

function Row({ b, h, trailing }: { b: GitBranchInfo; h: LocalGroupHandlers; trailing?: boolean }) {
  return (
    <div className="flex items-center gap-1">
      <div className="min-w-0 flex-1">
        <BranchRow
          branch={b}
          isCurrent={b.name === h.currentName}
          onCheckout={() => h.onCheckout(b)}
          onDelete={(force) => h.onDelete(b, force)}
          onMenu={(x, y) => h.onMenu(b, x, y)}
        />
      </div>
      {trailing && (
        <button
          type="button"
          title={t("为该分支建 worktree")}
          onClick={() => h.onCreateTree(b.name)}
          className="shrink-0 rounded px-1 py-0.5 text-[0.625rem] text-(--tmd-fg-faint) hover:bg-(--tmd-bg-hover) hover:text-(--tmd-fg)"
        >
          {t("建树")}
        </button>
      )}
    </div>
  );
}

/** 三分区:主仓检出 / 检出于某树(按树子组,标注当前)/ 未检出(行尾建树)。 */
export function LocalBranchGroups({
  groups,
  handlers,
}: {
  groups: WorktreeBranchGroups;
  handlers: LocalGroupHandlers;
}) {
  const h = handlers;
  return (
    <>
      {groups.main.length > 0 && (
        <>
          <div className="px-3 pt-1 text-[0.625rem] text-(--tmd-fg-faint)">
            {t("主仓检出 ({n})", { n: groups.main.length })}
          </div>
          {groups.main.map((b) => (
            <Row key={b.name} b={b} h={h} />
          ))}
        </>
      )}
      {groups.byTree.map((g) => (
        <div key={g.path}>
          <div className="mt-1 flex items-center gap-1 px-3 text-[0.625rem] text-(--tmd-fg-faint)">
            <span>
              {t("检出于 {tree}", { tree: g.path.split(/[\\/]/).filter(Boolean).pop() ?? g.path })}
            </span>
            {g.current && <span className="text-(--tmd-accent)">{t("当前")}</span>}
          </div>
          {g.branches.map((b) => (
            <Row key={b.name} b={b} h={h} />
          ))}
        </div>
      ))}
      {groups.free.length > 0 && (
        <>
          <div className="mt-1 px-3 text-[0.625rem] text-(--tmd-fg-faint)">
            {t("未检出 ({n})", { n: groups.free.length })}
          </div>
          {groups.free.map((b) => (
            <Row key={b.name} b={b} h={h} trailing />
          ))}
        </>
      )}
    </>
  );
}
