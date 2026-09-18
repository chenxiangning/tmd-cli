/**
 * lsp 插件入口 —— 语言服务器配置(ts/py/java 发现链)+ 编辑器扩展 + 键位。
 *
 * 语义动作面(spec):cmd/ctrl+click 跳定义(定义点→引用 peek)、Shift+F12
 * 引用 peek、F12 跳定义、右键菜单、hover 悬停签名。F12 为裸键,全局注册表
 * 解析不了 Cmd 前缀形式,走 match 型命令(⌘C 例外同款先例)。
 */

import { Code } from "@phosphor-icons/react";
import type { Plugin } from "@kernel/plugin";
import { t } from "@kernel/i18n";
import { findReferencesAtCursor, gotoDefinitionAtCursor, hasActiveEditor, lspEditorExtension } from "./cmLsp";
import { JavaGuideOverlay } from "./javaGuide";
import { openJavaGuide } from "./javaGuideStore";
import { discoverJava, discoverPython, discoverTypeScript, resolveJavaRoot } from "./discovery";
import "./locales";
import "./lsp.css";

export const lspPlugin: Plugin = {
  id: "lsp",
  meta: {
    name: "语言服务",
    abbr: "LS",
    desc: "语义跳转与引用(cmd/ctrl+点击 / F12 / ⇧F12 / hover)",
    icon: Code,
    iconColor: "#C69AC9",
    category: "feature",
  },
  activate(ctx) {
    ctx.registerLanguageServer({
      language: "typescript",
      extensions: [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"],
      discover: (root) => discoverTypeScript(root),
    });
    ctx.registerLanguageServer({
      language: "python",
      extensions: [".py"],
      discover: (root) => discoverPython(root),
    });
    ctx.registerLanguageServer({
      language: "java",
      extensions: [".java"],
      discover: async (root) => {
        const launch = await discoverJava();
        if (!launch) openJavaGuide();
        void root;
        return launch;
      },
      resolveRoot: (filePath, workspaceRoot) => resolveJavaRoot(filePath, workspaceRoot),
    });
    ctx.registerEditorExtension(lspEditorExtension);
    ctx.registerCommand({
      id: "lsp.gotoDefinition",
      title: t("转到定义"),
      match: (e) => e.key === "F12" && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey,
      keybindingLabel: "F12",
      when: hasActiveEditor,
      run: gotoDefinitionAtCursor,
    });
    ctx.registerCommand({
      id: "lsp.findReferences",
      title: t("查找引用"),
      keybinding: "Shift+F12",
      when: hasActiveEditor,
      run: findReferencesAtCursor,
    });
    ctx.contribute("overlay", { order: 60, component: JavaGuideOverlay });
  },
};
