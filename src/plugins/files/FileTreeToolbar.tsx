/**
 * 文件树工具条按钮组 —— 「文件」标签右缘:新建文件 + 新建文件夹 + 刷新 +
 * 面板专属动作(Git 变更着色开关)。
 *
 * 2026-10-02 自顶栏右区(外壳 FileActionsBar)下放回面板头,四个 icon 并进
 * 文件工具条一行;刷新与原头部刷新钮并轨只留一个(树全量重拉 + 打开中文件
 * tab 重读,语义单一真源在 treeHandles.refreshFiles)。本地/远程树差异由宿主
 * 以回调表达,本组件零树知识。
 */

import { ArrowClockwise, FilePlus, FolderSimplePlus } from "@phosphor-icons/react";
import { t } from "@kernel/i18n";
import { Spinner } from "@kernel/Spinner";
import { useMinSpin } from "@kernel/useMinSpin";
import { GitDecorateToggle } from "./gitDecorate";

export function FileTreeToolbar({
  onNewFile,
  onNewFolder,
  onRefresh,
  gitToggle = true,
}: {
  /** 新建文件;缺省按钮置灰(远程树宿主自给守卫回调,出 M1 提示)。 */
  onNewFile?: () => void;
  /** 新建文件夹;缺省按钮置灰。 */
  onNewFolder?: () => void;
  /** 刷新:Promise settle 前按钮转忙态(并发点击不重启)。 */
  onRefresh: () => void | Promise<void>;
  /** Git 变更着色开关:仅本地树消费(useGitDecorations 不挂远程源),远程树
   *  宿主传 false 隐藏 —— 该钮对远程树是零效果假动作钮。 */
  gitToggle?: boolean;
}) {
  const { spinning: refreshBusy, spin } = useMinSpin();

  return (
    <span className="file-tree-toolbar">
      <button
        type="button"
        className="file-tree-toolbar-action"
        aria-label={t("新建文件")}
        data-hint={t("新建文件")}
        data-hint-cmd="panel.newFile"
        title=""
        disabled={!onNewFile}
        onClick={onNewFile}
      >
        <FilePlus aria-hidden />
      </button>
      <button
        type="button"
        className="file-tree-toolbar-action"
        aria-label={t("新建文件夹")}
        data-hint={t("新建文件夹")}
        data-hint-cmd="panel.newFolder"
        title=""
        disabled={!onNewFolder}
        onClick={onNewFolder}
      >
        <FolderSimplePlus aria-hidden />
      </button>
      <button
        type="button"
        className="file-tree-toolbar-action"
        aria-label={t("刷新文件树")}
        data-hint={t("刷新文件树")}
        data-hint-cmd="panel.refresh"
        title=""
        onClick={() => spin(onRefresh)}
      >
        {/* 尺寸单一真源 = file-tree.css svg 0.875rem(Spinner 同档透传) */}
        {refreshBusy ? <Spinner size="0.875rem" /> : <ArrowClockwise aria-hidden />}
      </button>
      {gitToggle && <GitDecorateToggle />}
    </span>
  );
}
