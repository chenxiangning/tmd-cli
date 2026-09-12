/**
 * files 插件:右栏文件树(右键菜单 + 新建/重命名/删除)+ 中央 tab 文件编辑器。
 *
 * 视觉规范:
 * - 复刻 codemoss file-tree ─ 顶部 root label + 文件操作按钮(subbar 由外壳渲染)。
 * - 文件/文件夹行用 fileVisual 图标;行 hover 右侧按钮 = 在访达中显示 + 复制路径。
 * - 右键菜单走 wsmenu 范式(FileTreeContextMenu),命名走居中卡片(NamePrompt)。
 *
 * 注册点:
 * - fileVisual:可插拔文件图标/颜色(编辑器高亮走 CodeMirror)
 * - filePanel:{ refresh / newFile / newFolder } 槽,外壳 subbar 按钮消费
 * - shortcuts:files.save(⌘S 保存本地文件,when 限定激活 tab 为本地文件)
 *
 * 树组件拆至 FileTree.tsx / FileTreeRow.tsx(文件规模铁则),本文件只留注册面。
 */
import { PencilSimple, Folder } from "@phosphor-icons/react";
import { getActiveTab, getTabs } from "@kernel/tabs";
import type { Plugin, PluginContext } from "@kernel/plugin";
import { FileTabContent } from "./FileTabContent";
import { defaultFileVisualProvider } from "./fileVisual";
import { reloadFile } from "./editor/fileCache";
import { saveRequestRef } from "./editor/useFileDocument";
import { ActiveWorkspaceFileTree } from "./FileTree";
import { getActiveTreeHandles } from "./treeHandles";
import { GitDecorateToggle } from "./gitDecorate";

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
    ctx.registerFileVisual(defaultFileVisualProvider);

    ctx.registerFilePanel({
      id: "files",
      label: "文件",
      icon: Folder,
      component: ActiveWorkspaceFileTree,
      refresh: async () => {
        /* 刷新 = 树全量重拉(根层 + 展开目录)+ 打开中的文件 tab 重读磁盘,
           消灭目录快照与文件内容两层缓存滞后;草稿不受影响。 */
        await getActiveTreeHandles()?.reload();
        for (const tab of getTabs()) {
          if (tab.kind === "file") reloadFile(tab.path);
        }
      },
      newFile: () => getActiveTreeHandles()?.newFile(),
      newFolder: () => getActiveTreeHandles()?.newFolder(),
      actions: GitDecorateToggle,
    });
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
  },
};
