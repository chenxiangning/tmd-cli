/**
 * marks 插件 —— 文件阅读标记:行间锚点(CodeMirror 装饰)+ 全局标记中心(右栏
 * 面板,跨文件聚合)+ 发送引用(composer 变换自动尾拼 pending 标记)+ 终端回链
 * (path:Lx-Ly 点击定位)。
 *
 * 设计 spec:docs/superpowers/specs/2026-09-18-file-marks-design.md
 * 0 容忍红线:源文件零写入;标记存 sidecar ~/.tmd-cli/marks/<dirKey(cwd)>.json。
 */

import { BookmarkSimple } from "@phosphor-icons/react";
import { registerComposerSendTransform } from "@kernel/composerExt";
import { t } from "@kernel/i18n";
import type { Plugin } from "@kernel/plugin";
import { MarksPanel } from "./panel";
import { loadAllMarks } from "./store";
import { marksSendTransform } from "./sendTransform";
import { marksLinkProvider } from "./terminalLink";
import { marksEditorExtension } from "./editorExtension";

export const marksPlugin: Plugin = {
  id: "marks",
  meta: {
    name: t("文件标记"),
    abbr: "标记",
    desc: t("文件阅读标记:行间锚点、跨文件汇总,发送自动带引用,终端回链定位"),
    icon: BookmarkSimple,
    iconColor: "#EAB308",
    category: "feature",
  },
  permissions: ["ipc.fs.read", "ipc.fs.write"],
  activate(ctx) {
    void loadAllMarks().catch(() => undefined);
    ctx.registerFilePanel({
      id: "marks",
      label: t("标记"),
      icon: BookmarkSimple,
      component: MarksPanel,
      showFileSubbar: false,
      pinnedByDefault: true,
    });
    const offs = [
      ctx.registerEditorExtension(marksEditorExtension),
      ctx.registerTerminalLinkProvider(marksLinkProvider),
      registerComposerSendTransform(marksSendTransform),
    ];
    /* 反注册钩先设:下方注册中途抛错也不留半注册状态(assets 同款) */
    this.deactivate = () => {
      for (const off of offs) off();
    };
  },
};
