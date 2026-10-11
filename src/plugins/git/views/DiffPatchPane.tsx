/**
 * diff patch 区状态链 —— 工作区 tab 与提交 tab 共用(此前两份同构实现,
 * react-doctor no-high-complexity / duplicate-jsx-subtree 双警根源)。
 * 状态→节点映射下沉纯函数 paneBody(非组件函数),组件只剩外壳容器。
 */
import type { ReactNode } from "react";
import { t } from "@kernel/i18n";
import { Spinner } from "@kernel/Spinner";
import type { GitDiffMode } from "@kernel/settings";
import type { GitFilePatch } from "@kernel/ipc";
import { gitErrorDisplay } from "../gitError";
import { PatchLines } from "./PatchLines";

function paneBody(props: {
  patchLoading: boolean;
  patchError: string | null;
  patch: GitFilePatch | null;
  selected: string | null;
  diffMode: GitDiffMode;
  fullView: boolean;
  expandFolds: boolean;
  emptyText: string;
}): ReactNode {
  const { patchLoading, patchError, patch, selected, diffMode, fullView, expandFolds, emptyText } = props;
  if (patchLoading) {
    return (
      <div className="flex h-full items-center justify-center gap-1.5 py-6 text-(--tmd-fg-faint)">
        <Spinner size="0.875rem" /> {t("加载 diff…")}
      </div>
    );
  }
  if (patchError) {
    return <div className="px-3 py-3 text-(--tmd-diff-removed)">{gitErrorDisplay(patchError)}</div>;
  }
  if (patch?.binary) {
    return <div className="px-3 py-6 text-center text-(--tmd-fg-faint)">{t("二进制文件,无文本 diff")}</div>;
  }
  if (patch) {
    return (
      <PatchLines
        key={selected}
        text={patch.patch}
        className="h-max min-h-full"
        mode={diffMode}
        fold={fullView && !expandFolds}
        path={selected}
      />
    );
  }
  if (selected) {
    return <div className="px-3 py-6 text-center text-(--tmd-fg-faint)">{emptyText}</div>;
  }
  return (
    <div className="flex h-full items-center justify-center text-(--tmd-fg-faint)">
      {t("选择左侧文件查看 diff")}
    </div>
  );
}

export function DiffPatchPane(props: {
  patchLoading: boolean;
  patchError: string | null;
  patch: GitFilePatch | null;
  selected: string | null;
  diffMode: GitDiffMode;
  fullView: boolean;
  expandFolds: boolean;
  /** patch 就绪但无文本时的空态文案(工作区/提交各有措辞)。 */
  emptyText: string;
}) {
  return <div className="min-w-0 flex-1 overflow-auto">{paneBody(props)}</div>;
}
