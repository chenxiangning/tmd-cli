/**
 * files 插件:右栏文件树(右键菜单 + 新建/重命名/删除)+ 中央 tab 文件编辑器。
 *
 * 视觉规范:
 * - 复刻 codemoss file-tree ─ 工作区选择器在顶栏,文件操作按钮在面板头工具条
 *   (FileTreeToolbar,2026-10-02 自顶栏右区下放回面板,插件自渲染)。
 * - 文件/文件夹行用 fileVisual 图标;行 hover 右侧按钮 = 在访达中显示 + 复制路径。
 * - 右键菜单走 wsmenu 范式(FileTreeContextMenu),命名走居中卡片(NamePrompt)。
 *
 * 注册点:
 * - fileVisual:可插拔文件图标/颜色(编辑器高亮走 CodeMirror)
 * - filePanel:{ refresh / newFile / newFolder } 槽,键位命令(panel.refresh 等)消费
 * - shortcuts:files.save(⌘S 保存本地文件,when 限定激活 tab 为本地文件)
 *
 * 树组件拆至 FileTree.tsx / FileTreeRow.tsx(文件规模铁则),本文件只留注册面。
 */
import { PencilSimple, Folder } from "@phosphor-icons/react";
import { getActiveTab } from "@kernel/tabs";
import type { Plugin, PluginContext } from "@kernel/plugin";
import { FileTabContent } from "./FileTabContent";
import { defaultFileVisualProvider } from "./fileVisual";
import { saveRequestRef } from "./editor/useFileDocument";
import { collectRevealTargets, refreshFiles } from "./treeHandles";
import { fileDetailActions, blameToggleRef } from "./fileDetailActions";
import { getActiveWorkspace } from "@kernel/workspace";
import { fileHistoryOpenRef } from "@kernel/fileHistoryBridge";
import { ActiveWorkspaceFileTree } from "./FileTree";
import { setFileMarkBus } from "./markBridge";
import { requestTreeNew } from "./treeHandles";
import { WorkspaceFileBrowser } from "./WorkspaceFileBrowser";
import { registerWorkspaceFileBrowser } from "@kernel/workspaceFileBrowser";
import { retryImport } from "@kernel/lazyImport";

export const filesPlugin: Plugin = {
  id: "files",
  meta: {
    name: "文件编辑",
    abbr: "FL",
    desc: "文件树、文件编辑、Markdown 预览",
    icon: PencilSimple,
    iconColor: "#4DAF7C",
    category: "feature",
  },
  activate(ctx: PluginContext) {
    /* 空闲预取编辑器 chunk:dev 冷启动期 vite 依赖优化未完时替用户先走完 504
       重试链,首开文件即时挂载(生产 = 提前热身,零首屏影响)。 */
    (typeof requestIdleCallback === "function"
      ? requestIdleCallback
      : (cb: () => void) => setTimeout(cb, 2_000))(() => {
      void retryImport(() => import("@kernel/cmEditor/FileCodeEditor"))().catch(() => {});
    });
    setFileMarkBus(ctx.events);
    ctx.registerFileVisual(defaultFileVisualProvider);

    ctx.registerFilePanel({
      id: "files",
      label: "文件",
      icon: Folder,
      component: ActiveWorkspaceFileTree,
      /* 刷新语义单一真源 = treeHandles.refreshFiles(树重拉 + 打开中 tab 重读),
         与面板头工具条刷新钮同入口;草稿不受影响。 */
      refresh: refreshFiles,
      /* 新建走 requestTreeNew:树未挂载(工作区/面板切换重挂中)时意图排队,
         挂载即弹命名框 —— 消灭调用侧 400ms 定时器赌时序(见 treeHandles.ts)。 */
      newFile: () => requestTreeNew("newFile"),
      newFolder: () => requestTreeNew("newFolder"),
      /* rail 归组:工作区组(files/git 首组,位置不变;组间画分隔线) */
      order: 0,
      railGroup: "workspace",
    });
    /* 左栏工作区「查看文件」浏览器实现(kernel workspaceFileBrowser 契约);
       拔出本插件 = 入口按钮消失、已开视图自动关闭,右栏文件树零感知。 */
    registerWorkspaceFileBrowser(WorkspaceFileBrowser);
    /* 中央文件 tab 内容:kind="file" 路由(kernel/tabs 注册表)。 */
    ctx.registerTabContent({ kind: "file", component: FileTabContent });
    /* ⌘S 保存命令:when 限定激活 tab 为本地文件 tab(kind="file"),否则键穿透;
       与 ssh.saveRemoteFile 同键,靠 when 互斥。触发经模块级 ref 桥转发到挂载中的编辑器。 */
    ctx.registerCommand({
      id: "files.save",
      title: "保存本地文件",
      keybinding: "Cmd+S",
      when: () => getActiveTab()?.kind === "file",
      run: () => saveRequestRef.current?.(),
    });
    /* 详情页三项 JetBrains 同型快捷键(⌥F1 定位 / ⌥⇧H 文件历史 / ⌥⇧B blame):
       when 限定激活 tab 为文件详情;远程文件时 Git 类动作经桥自守卫跳过。 */
    ctx.registerCommand({
      id: "files.revealToTree",
      title: "定位到文件",
      keybinding: "Alt+F1",
      when: () => getActiveTab()?.kind === "file",
      run: () => {
        const a = fileDetailActions.current;
        if (!a || a.remote) return;
        for (const reveal of collectRevealTargets()) reveal(a.path);
      },
    });
    ctx.registerCommand({
      id: "files.showFileHistory",
      title: "显示文件历史",
      keybinding: "Alt+Shift+H",
      when: () => getActiveTab()?.kind === "file",
      run: () => {
        const a = fileDetailActions.current;
        if (!a || a.remote) return;
        const ws = getActiveWorkspace();
        const base = ws ? ws.root.replace(/[\\/]+$/, "") : "";
        const rel = base && a.path.startsWith(`${base}/`) ? a.path.slice(base.length + 1) : "";
        if (rel) fileHistoryOpenRef.current?.({ cwd: base, path: rel });
      },
    });
    ctx.registerCommand({
      id: "files.toggleGitBlame",
      title: "显示 Git Blame",
      keybinding: "Alt+Shift+B",
      when: () => getActiveTab()?.kind === "file",
      run: () => blameToggleRef.current?.(),
    });
    return () => registerWorkspaceFileBrowser(null);
  },
};
