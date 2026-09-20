/**
 * prompt-enhancer 插件 —— composer 左下「增强提示词」入口(spec 2026-09-21):
 * - composer.inputRail order 50:✦ 图标,取输入框草稿弹并排对照对话框
 * - 一次性改写走 proc_communicate 通用原语;8 家 CLI argv 组装收口在 enhanceEngines
 * - 使用增强版本经 composerReplaceRef 整替草稿
 */
import { SparkleIcon } from "@phosphor-icons/react";
import type { Plugin } from "@kernel/plugin";
import { t } from "@kernel/i18n";
import { composerDraftRef } from "@kernel/composerExt";
import { EnhanceButton } from "./EnhanceButton";
import { openEnhance } from "./enhanceOpen";
import "./locales"; /* 域词典随插件自带:import 即注册 */

export const promptEnhancerPlugin: Plugin = {
  id: "prompt-enhancer",
  meta: {
    name: "增强提示词",
    abbr: "PE",
    desc: "把输入框草稿交给一次性 CLI 改写,并排对照后一键回填",
    icon: SparkleIcon,
    iconColor: "#A78BFA",
    category: "feature",
  },
  permissions: ["ipc.terminal", "ipc.fs.read", "ipc.fs.write", "settings.write"],
  activate(ctx) {
    ctx.contribute("composer.inputRail", { order: 50, component: EnhanceButton });
    /* ⌘⌥E 唤起增强(草稿非空才生效);键位空闲实证 2026-09-21(⌘⇧E 被会话切换占用) */
    ctx.registerCommand({
      id: "promptEnhancer.run",
      title: t("增强提示词"),
      keybinding: "Cmd+Alt+E",
      when: () => Boolean(composerDraftRef.current?.().trim()),
      run: () => openEnhance(),
    });
  },
};
